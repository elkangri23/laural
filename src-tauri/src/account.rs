use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use keyring::Entry;
use reqwest::{Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use zeroize::Zeroizing;

const SYNC_ORIGIN: &str = "https://sync.laurafernandezenfermeria.com";
const SESSION_SERVICE: &str = "laural.sync";
const SESSION_ACCOUNT: &str = "account-session";
const CALLBACK_PATH: &str = "/callback";
const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
const AUTH_EVENT: &str = "account-auth-status";
static LOGIN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

struct LoginGuard;

impl LoginGuard {
    fn acquire() -> Result<Self, String> {
        LOGIN_IN_PROGRESS
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| "Ya hay un inicio de sesión en curso.".to_string())
    }
}

impl Drop for LoginGuard {
    fn drop(&mut self) {
        LOGIN_IN_PROGRESS.store(false, Ordering::Release);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthStatus {
    status: &'static str,
    message: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionResponse {
    session_token: String,
    expires_at: String,
}

#[tauri::command]
pub fn account_session_status() -> Result<bool, String> {
    Ok(read_session()?.is_some())
}

#[tauri::command]
pub fn start_account_login(app: AppHandle) -> Result<(), String> {
    let guard = LoginGuard::acquire()?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "No se pudo iniciar el callback local de autenticación.".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "No se pudo preparar el callback local de autenticación.".to_string())?;
    let port = listener
        .local_addr()
        .map_err(|_| "No se pudo obtener el puerto local de autenticación.".to_string())?
        .port();

    let state = random_token()?;
    let verifier = Zeroizing::new(random_token()?);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let mut login_url = Url::parse(&format!("{SYNC_ORIGIN}/auth/native"))
        .map_err(|_| "La dirección del servicio de cuenta no es válida.".to_string())?;
    login_url
        .query_pairs_mut()
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");

    app.opener()
        .open_url(login_url.as_str(), None::<&str>)
        .map_err(|_| "No se pudo abrir el navegador para iniciar sesión.".to_string())?;
    emit_status(
        &app,
        "waiting",
        "Completa el inicio de sesión en el navegador.",
    );

    thread::spawn(move || {
        run_callback(listener, state, verifier, app);
        drop(guard);
    });
    Ok(())
}

#[tauri::command]
pub fn clear_account_session() -> Result<(), String> {
    let entry = session_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("No se pudo borrar la sesión del almacén seguro de Windows.".into()),
    }
}

fn run_callback(
    listener: TcpListener,
    expected_state: String,
    verifier: Zeroizing<String>,
    app: AppHandle,
) {
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    let mut invalid_requests = 0;

    while Instant::now() < deadline && invalid_requests < 5 {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let request = read_callback_request(&mut stream);
                let callback = request.and_then(|request| parse_callback(&request));
                match callback {
                    Ok((code, state))
                        if constant_time_equal(state.as_bytes(), expected_state.as_bytes()) =>
                    {
                        write_callback_response(&mut stream, true);
                        exchange_code(app, code, verifier);
                        return;
                    }
                    _ => {
                        invalid_requests += 1;
                        write_callback_response(&mut stream, false);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                emit_status(&app, "error", "Falló el callback de autenticación.");
                return;
            }
        }
    }
    emit_status(
        &app,
        "error",
        "El inicio de sesión caducó. Vuelve a intentarlo.",
    );
}

fn read_callback_request(stream: &mut TcpStream) -> Result<Vec<u8>, ()> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0; 1024];
    loop {
        let count = stream.read(&mut chunk).map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        request.extend_from_slice(&chunk[..count]);
        if request.len() > MAX_CALLBACK_BYTES {
            return Err(());
        }
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(request);
        }
    }
}

fn parse_callback(request: &[u8]) -> Result<(String, String), ()> {
    let request_line = request.split(|byte| *byte == b'\n').next().ok_or(())?;
    let request_line = std::str::from_utf8(request_line)
        .map_err(|_| ())?
        .trim_end_matches('\r');
    let mut parts = request_line.split_ascii_whitespace();
    if parts.next() != Some("GET") {
        return Err(());
    }
    let target = parts.next().ok_or(())?;
    if parts.next() != Some("HTTP/1.1") || parts.next().is_some() {
        return Err(());
    }

    let callback_url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| ())?;
    if callback_url.host_str() != Some("127.0.0.1")
        || callback_url.path() != CALLBACK_PATH
        || callback_url.fragment().is_some()
        || !callback_url.username().is_empty()
        || callback_url.password().is_some()
    {
        return Err(());
    }
    let mut code = None;
    let mut state = None;
    for (key, value) in callback_url.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() && valid_token(&value) => code = Some(value.into_owned()),
            "state" if state.is_none() && valid_token(&value) => state = Some(value.into_owned()),
            _ => return Err(()),
        }
    }
    Ok((code.ok_or(())?, state.ok_or(())?))
}

fn write_callback_response(stream: &mut TcpStream, success: bool) {
    let (status, body) = if success {
        (
            "200 OK",
            "<h1>Inicio de sesión recibido</h1><p>Puedes volver a Laural.</p>",
        )
    } else {
        (
            "400 Bad Request",
            "<h1>Solicitud no válida</h1><p>Vuelve a Laural e inténtalo de nuevo.</p>",
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn exchange_code(app: AppHandle, code: String, verifier: Zeroizing<String>) {
    tauri::async_runtime::spawn(async move {
        let result = exchange_and_store(&code, &verifier).await;
        match result {
            Ok(()) => emit_status(
                &app,
                "signed_in",
                "Sesión iniciada y guardada en el almacén seguro de Windows.",
            ),
            Err(()) => emit_status(
                &app,
                "error",
                "No se pudo completar el inicio de sesión. Revisa la conexión y vuelve a intentarlo.",
            ),
        }
    });
}

async fn exchange_and_store(code: &str, verifier: &str) -> Result<(), ()> {
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| ())?;
    let response = client
        .post(format!("{SYNC_ORIGIN}/v1/auth/native/exchange"))
        .json(&serde_json::json!({ "code": code, "codeVerifier": verifier }))
        .send()
        .await
        .map_err(|_| ())?;
    if !response.status().is_success() || response.content_length().is_some_and(|size| size > 4096)
    {
        return Err(());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::with_capacity(1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ())?;
        if body.len() + chunk.len() > 4096 {
            return Err(());
        }
        body.extend_from_slice(&chunk);
    }
    let grant: SessionResponse = serde_json::from_slice(&body).map_err(|_| ())?;
    if !valid_token(&grant.session_token)
        || grant.expires_at.is_empty()
        || grant.expires_at.len() > 64
    {
        return Err(());
    }
    let token = Zeroizing::new(grant.session_token);
    let entry = session_entry().map_err(|_| ())?;
    entry.set_password(&token).map_err(|_| ())?;
    let saved = Zeroizing::new(entry.get_password().map_err(|_| ())?);
    if constant_time_equal(token.as_bytes(), saved.as_bytes()) {
        Ok(())
    } else {
        Err(())
    }
}

fn emit_status(app: &AppHandle, status: &'static str, message: &'static str) {
    let _ = app.emit(AUTH_EVENT, AuthStatus { status, message });
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| "No se pudo generar una sesión segura.".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn valid_token(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn session_entry() -> Result<Entry, String> {
    Entry::new(SESSION_SERVICE, SESSION_ACCOUNT)
        .map_err(|_| "Windows no pudo acceder al almacén seguro de sesiones.".to_string())
}

fn read_session() -> Result<Option<Zeroizing<String>>, String> {
    match session_entry()?.get_password() {
        Ok(token) if valid_token(&token) => Ok(Some(Zeroizing::new(token))),
        Ok(_) => Err("La sesión guardada no tiene un formato válido.".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("No se pudo leer la sesión del almacén seguro de Windows.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(target: &str) -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").into_bytes()
    }

    #[test]
    fn acepta_callback_con_codigo_y_state_aleatorios() {
        let parsed = parse_callback(&request(&format!(
            "/callback?code={}&state={}",
            "a".repeat(43),
            "b".repeat(43)
        )));
        assert_eq!(parsed.unwrap(), ("a".repeat(43), "b".repeat(43)));
    }

    #[test]
    fn rechaza_callback_con_metodo_ruta_campos_o_parametros_repetidos() {
        assert!(
            parse_callback(&request(&format!(
                "/elsewhere?code={}&state={}",
                "a".repeat(43),
                "b".repeat(43)
            )))
            .is_err()
        );
        assert!(
            parse_callback(&request(&format!(
                "//evil/callback?code={}&state={}",
                "a".repeat(43),
                "b".repeat(43)
            )))
            .is_err()
        );
        assert!(
            parse_callback(&request(&format!(
                "/callback?code={}&code={}&state={}",
                "a".repeat(43),
                "b".repeat(43),
                "c".repeat(43)
            )))
            .is_err()
        );
        assert!(
            parse_callback(&request(&format!(
                "/callback?code={}&state={}&extra=1",
                "a".repeat(43),
                "b".repeat(43)
            )))
            .is_err()
        );
        assert!(parse_callback(b"POST /callback HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").is_err());
    }

    #[test]
    fn compara_state_sin_ataques_de_tiempo() {
        assert!(constant_time_equal(b"state", b"state"));
        assert!(!constant_time_equal(b"state", b"other"));
        assert!(!constant_time_equal(b"short", b"longer"));
    }

    #[test]
    fn impide_iniciar_dos_flows_de_login_a_la_vez() {
        let guard = LoginGuard::acquire().unwrap();
        assert!(LoginGuard::acquire().is_err());
        drop(guard);
        assert!(LoginGuard::acquire().is_ok());
    }

    #[test]
    fn callback_local_responde_con_html_estatico_y_sin_cache() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            write_callback_response(&mut stream, true);
        });
        let mut response = String::new();
        TcpStream::connect(address)
            .unwrap()
            .read_to_string(&mut response)
            .unwrap();
        server.join().unwrap();

        assert!(response.contains("Cache-Control: no-store"));
        assert!(response.contains("X-Content-Type-Options: nosniff"));
        assert!(response.contains("Content-Security-Policy: default-src 'none'"));
        assert!(response.contains("Inicio de sesión recibido"));
    }

    #[test]
    fn emite_tokens_pkce_en_formato_url_seguro() {
        let token = random_token().unwrap();
        assert!(valid_token(&token));
        assert!(!valid_token("bad token"));
    }
}
