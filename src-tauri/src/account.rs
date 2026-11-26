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
use reqwest::{Client, Method, redirect::Policy};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use zeroize::Zeroizing;

pub(crate) const SYNC_ORIGIN: &str = "https://sync.laurafernandezenfermeria.com";
const SESSION_SERVICE: &str = "laural.sync";
const SESSION_ACCOUNT: &str = "account-session";
const CALLBACK_PATH: &str = "/callback";
const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);
const ACCOUNT_API_TIMEOUT: Duration = Duration::from_secs(8);
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

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSession {
    id: String,
    created_at: String,
    expires_at: String,
    current: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountSessionsResponse {
    sessions: Vec<AccountSession>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevokedSessionsResponse {
    revoked: u32,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountMfaStatus {
    pub totp_enabled: bool,
    pub recovery_codes_remaining: u8,
    pub enrollment_pending: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TotpEnrollment {
    pub secret: String,
    pub provisioning_uri: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDeletionResult {
    pub session_credential_cleared: bool,
    pub sync_state_cleared: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryCodesResponse {
    recovery_codes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasskeyStatusResponse {
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasskeyManagementLinkResponse {
    url: String,
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
pub async fn clear_account_session() -> Result<bool, String> {
    let token = read_session()?;
    let remotely_revoked = match token.as_deref() {
        Some(token) => revoke_remote_session(token).await,
        None => false,
    };
    let entry = session_entry()?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(remotely_revoked),
        Err(_) => Err("No se pudo borrar la sesión del almacén seguro de Windows.".into()),
    }
}

#[tauri::command]
pub async fn delete_account(
    app: AppHandle,
    confirmation: String,
) -> Result<AccountDeletionResult, String> {
    if !valid_account_deletion_confirmation(&confirmation) {
        return Err("Escribe ELIMINAR para confirmar el borrado definitivo.".into());
    }
    let token = session_token()?;
    request_account_deletion(
        &account_api_client()?,
        &format!("{SYNC_ORIGIN}/v1/auth/account"),
        token.as_str(),
        &confirmation,
    )
    .await?;
    clear_deleted_account_local_data_inner(&app).await
}

async fn request_account_deletion(
    client: &Client,
    endpoint: &str,
    token: &str,
    confirmation: &str,
) -> Result<(), String> {
    let response = client
        .delete(endpoint)
        .bearer_auth(token)
        .json(&serde_json::json!({ "confirmation": confirmation }))
        .send()
        .await
        .map_err(|_| {
            "No se pudo confirmar el borrado de la cuenta. Comprueba la conexión antes de volver a intentarlo."
                .to_string()
        })?;
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("La sesión ya no es reciente. Vuelve a iniciar sesión y confirma el borrado dentro de los diez minutos siguientes.".into());
    }
    if response.status() != reqwest::StatusCode::NO_CONTENT {
        return Err(
            "No se pudo borrar la cuenta. Comprueba la sesión e inténtalo de nuevo.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn clear_deleted_account_local_data(
    app: AppHandle,
) -> Result<AccountDeletionResult, String> {
    clear_deleted_account_local_data_inner(&app).await
}

async fn clear_deleted_account_local_data_inner(
    app: &AppHandle,
) -> Result<AccountDeletionResult, String> {
    let session_result = session_entry().map(|entry| entry.delete_credential());
    let session_credential_cleared = session_credential_delete_succeeded(session_result);
    let sync_state_cleared =
        sync_state_delete_succeeded(crate::sync::forget_local_preference_sync_state(app).await);
    Ok(AccountDeletionResult {
        session_credential_cleared,
        sync_state_cleared,
    })
}

fn session_credential_delete_succeeded(result: Result<keyring::Result<()>, String>) -> bool {
    matches!(result, Ok(Ok(())) | Ok(Err(keyring::Error::NoEntry)))
}

fn sync_state_delete_succeeded(result: Result<(), String>) -> bool {
    result.is_ok()
}

fn valid_account_deletion_confirmation(value: &str) -> bool {
    value == "ELIMINAR"
}

#[tauri::command]
pub async fn list_account_sessions() -> Result<Vec<AccountSession>, String> {
    let token = session_token()?;
    let client = account_api_client()?;
    request_account_sessions(
        &client,
        &format!("{SYNC_ORIGIN}/v1/auth/sessions"),
        token.as_str(),
    )
    .await
}

async fn request_account_sessions(
    client: &Client,
    endpoint: &str,
    token: &str,
) -> Result<Vec<AccountSession>, String> {
    let response = client
        .get(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudieron consultar las sesiones de la cuenta.".to_string())?;
    if !response.status().is_success() {
        return Err("No se pudieron consultar las sesiones de la cuenta.".into());
    }
    response
        .json::<AccountSessionsResponse>()
        .await
        .map(|body| body.sessions)
        .map_err(|_| "La respuesta de sesiones no tiene un formato válido.".into())
}

#[tauri::command]
pub async fn revoke_account_session(session_id: String) -> Result<bool, String> {
    if !valid_session_id(&session_id) {
        return Err("El identificador de sesión no es válido.".into());
    }
    let token = session_token()?;
    let client = account_api_client()?;
    request_revoke_account_session(
        &client,
        &format!("{SYNC_ORIGIN}/v1/auth/sessions/{session_id}"),
        token.as_str(),
    )
    .await
}

async fn request_revoke_account_session(
    client: &Client,
    endpoint: &str,
    token: &str,
) -> Result<bool, String> {
    let response = client
        .delete(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudo revocar la sesión seleccionada.".to_string())?;
    Ok(response.status() == reqwest::StatusCode::NO_CONTENT)
}

#[tauri::command]
pub async fn revoke_other_account_sessions() -> Result<u32, String> {
    let token = session_token()?;
    let client = account_api_client()?;
    request_revoke_other_account_sessions(
        &client,
        &format!("{SYNC_ORIGIN}/v1/auth/sessions/revoke-others"),
        token.as_str(),
    )
    .await
}

async fn request_revoke_other_account_sessions(
    client: &Client,
    endpoint: &str,
    token: &str,
) -> Result<u32, String> {
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudieron revocar las demás sesiones.".to_string())?;
    if !response.status().is_success() {
        return Err("No se pudieron revocar las demás sesiones.".into());
    }
    response
        .json::<RevokedSessionsResponse>()
        .await
        .map(|body| body.revoked)
        .map_err(|_| "La respuesta de revocación no tiene un formato válido.".into())
}

#[tauri::command]
pub async fn get_account_mfa_status() -> Result<AccountMfaStatus, String> {
    let token = session_token()?;
    let client = account_api_client()?;
    request_account_json(
        &client,
        Method::GET,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa"),
        token.as_str(),
        None,
        "No se pudo consultar la seguridad de la cuenta.",
        "No se pudo consultar la seguridad de la cuenta.",
    )
    .await
}

#[tauri::command]
pub async fn get_account_passkeys_enabled() -> Result<bool, String> {
    let token = session_token()?;
    let client = account_api_client()?;
    request_account_json::<PasskeyStatusResponse>(
        &client,
        Method::GET,
        &format!("{SYNC_ORIGIN}/v1/auth/passkeys/status"),
        token.as_str(),
        None,
        "No se pudo consultar la disponibilidad de passkeys.",
        "No se pudo consultar la disponibilidad de passkeys.",
    )
    .await
    .map(|result| result.enabled)
}

#[tauri::command]
pub async fn start_passkey_management(app: AppHandle) -> Result<(), String> {
    let token = session_token()?;
    let url = request_passkey_management_url(
        &account_api_client()?,
        &format!("{SYNC_ORIGIN}/v1/auth/passkeys/manage-link"),
        token.as_str(),
    )
    .await?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "No se pudo abrir el navegador para gestionar passkeys.".to_string())
}

async fn request_passkey_management_url(
    client: &Client,
    endpoint: &str,
    token: &str,
) -> Result<Url, String> {
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudo abrir la gestión de passkeys.".to_string())?;
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("Vuelve a iniciar sesión para gestionar tus passkeys.".into());
    }
    let link = bounded_response_json::<PasskeyManagementLinkResponse>(
        response,
        "No se pudo abrir la gestión de passkeys.",
    )
    .await?;
    let url =
        Url::parse(&link.url).map_err(|_| "El enlace de passkeys no es válido.".to_string())?;
    if !is_allowed_passkey_management_url(&url) {
        return Err("El servicio devolvió un enlace de passkeys no permitido.".into());
    }
    Ok(url)
}

fn is_allowed_passkey_management_url(url: &Url) -> bool {
    let ticket_valid = url
        .fragment()
        .and_then(|fragment| fragment.strip_prefix("ticket="))
        .is_some_and(valid_token);
    ticket_valid
        && url.query().is_none()
        && url.origin().ascii_serialization() == SYNC_ORIGIN
        && url.path() == "/auth/passkeys/manage"
        && url.username().is_empty()
        && url.password().is_none()
}

#[tauri::command]
pub async fn start_totp_enrollment() -> Result<TotpEnrollment, String> {
    let token = session_token()?;
    request_account_json(
        &account_api_client()?,
        Method::POST,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/totp/enrollment"),
        token.as_str(),
        None,
        "No se pudo iniciar la configuración de TOTP.",
        "Vuelve a iniciar sesión e inténtalo de nuevo.",
    )
    .await
}

#[tauri::command]
pub async fn confirm_totp_enrollment(code: String) -> Result<Vec<String>, String> {
    if !valid_totp_code(&code) {
        return Err("Introduce el código de seis dígitos de tu aplicación.".into());
    }
    let token = session_token()?;
    request_account_json::<RecoveryCodesResponse>(
        &account_api_client()?,
        Method::POST,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/totp/enrollment/confirm"),
        token.as_str(),
        Some(serde_json::json!({ "code": code })),
        "No se pudo verificar el código TOTP.",
        "El código caducó o no es válido. Inicia sesión de nuevo si hace más de diez minutos.",
    )
    .await
    .map(|body| body.recovery_codes)
}

#[tauri::command]
pub async fn complete_totp_enrollment() -> Result<(), String> {
    let token = session_token()?;
    request_account_no_content(
        &account_api_client()?,
        Method::POST,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/totp/enrollment/complete"),
        token.as_str(),
        "No se pudo activar TOTP.",
        "No se pudo activar TOTP. Confirma que guardaste los códigos e inicia sesión de nuevo si es necesario.",
    )
    .await
}

#[tauri::command]
pub async fn cancel_totp_enrollment() -> Result<(), String> {
    let token = session_token()?;
    request_account_no_content(
        &account_api_client()?,
        Method::DELETE,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/totp/enrollment"),
        token.as_str(),
        "No se pudo cancelar el enrolamiento TOTP.",
        "No se pudo cancelar el enrolamiento TOTP.",
    )
    .await
}

#[tauri::command]
pub async fn rotate_account_recovery_codes() -> Result<Vec<String>, String> {
    let token = session_token()?;
    request_account_json::<RecoveryCodesResponse>(
        &account_api_client()?,
        Method::POST,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/recovery-codes/rotate"),
        token.as_str(),
        None,
        "No se pudieron renovar los códigos de recuperación.",
        "Vuelve a iniciar sesión e inténtalo de nuevo.",
    )
    .await
    .map(|body| body.recovery_codes)
}

#[tauri::command]
pub async fn disable_account_totp() -> Result<(), String> {
    let token = session_token()?;
    request_account_no_content(
        &account_api_client()?,
        Method::DELETE,
        &format!("{SYNC_ORIGIN}/v1/auth/mfa/totp"),
        token.as_str(),
        "No se pudo desactivar TOTP.",
        "Vuelve a iniciar sesión y vuelve a intentarlo.",
    )
    .await
}

async fn request_account_json<T: DeserializeOwned>(
    client: &Client,
    method: Method,
    endpoint: &str,
    token: &str,
    body: Option<Value>,
    transport_failure: &str,
    response_failure: &str,
) -> Result<T, String> {
    let mut request = client.request(method, endpoint).bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| transport_failure.to_string())?;
    bounded_response_json(response, response_failure).await
}

async fn request_account_no_content(
    client: &Client,
    method: Method,
    endpoint: &str,
    token: &str,
    transport_failure: &str,
    response_failure: &str,
) -> Result<(), String> {
    let response = client
        .request(method, endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| transport_failure.to_string())?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        Ok(())
    } else {
        Err(response_failure.to_string())
    }
}

async fn bounded_response_json<T: DeserializeOwned>(
    response: reqwest::Response,
    failure: &str,
) -> Result<T, String> {
    if !response.status().is_success() || response.content_length().is_some_and(|size| size > 4096)
    {
        return Err(failure.to_string());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::with_capacity(1024);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| failure.to_string())?;
        if body.len() + chunk.len() > 4096 {
            return Err(failure.to_string());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| failure.to_string())
}

fn valid_totp_code(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn account_api_client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(ACCOUNT_API_TIMEOUT)
        .build()
        .map_err(|_| "No se pudo preparar la conexión segura al servicio de cuenta.".to_string())
}

fn valid_session_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

async fn revoke_remote_session(token: &str) -> bool {
    let Ok(client) = account_api_client() else {
        return false;
    };
    let Ok(response) = client
        .post(format!("{SYNC_ORIGIN}/v1/auth/session/revoke"))
        .bearer_auth(token)
        .send()
        .await
    else {
        return false;
    };
    remote_revocation_confirmed(response.status())
}

fn remote_revocation_confirmed(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::NO_CONTENT | reqwest::StatusCode::UNAUTHORIZED
    )
}

fn run_callback(
    listener: TcpListener,
    expected_state: String,
    verifier: Zeroizing<String>,
    app: AppHandle,
) {
    match receive_login_callback(listener, &expected_state, LOGIN_TIMEOUT) {
        Ok(code) => exchange_code(app, code, verifier),
        Err(CallbackFailure::Listener) => {
            emit_status(&app, "error", "Falló el callback de autenticación.");
        }
        Err(CallbackFailure::Expired) => {
            emit_status(
                &app,
                "error",
                "El inicio de sesión caducó. Vuelve a intentarlo.",
            );
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CallbackFailure {
    Listener,
    Expired,
}

fn receive_login_callback(
    listener: TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, CallbackFailure> {
    let deadline = Instant::now() + timeout;
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
                        return Ok(code);
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
            Err(_) => return Err(CallbackFailure::Listener),
        }
    }
    Err(CallbackFailure::Expired)
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

// Misma paleta que las páginas de acceso del servidor (server/web/auth.css):
// fondo verde oscuro, acento #9bc66c, tarjeta con borde y sombra. La página es
// estática y autocontenida: sin scripts ni recursos externos, solo <style> en
// línea, por eso la CSP permite style-src 'unsafe-inline'.
const CALLBACK_CSS: &str = r##":root { color-scheme: dark; font-family: "Segoe UI Variable", "Segoe UI", sans-serif; background: #101511; color: #edf3ec; }
* { box-sizing: border-box; }
body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 32px 18px; background: radial-gradient(ellipse at 50% 0%, #26382a 0, #101511 58%); }
.shell { width: min(100%, 540px); }
.brand { display: flex; align-items: center; gap: 12px; margin: 0 0 22px 4px; }
.mark { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 13px; background: #9bc66c; color: #142014; font-weight: 800; }
.brand-name { font-size: 19px; font-weight: 700; letter-spacing: .02em; }
.brand-caption { color: #a9b6aa; font-size: 12px; margin-top: 2px; }
main { padding: clamp(24px, 6vw, 42px); border: 1px solid #344138; border-radius: 22px; background: #19201b; box-shadow: 0 24px 80px #0006; text-align: center; }
.status { width: 64px; height: 64px; margin: 0 auto 20px; display: grid; place-items: center; border-radius: 50%; font-size: 32px; font-weight: 800; }
.status.ok { background: #9bc66c; color: #142014; }
.status.error { background: #5a2b2b; color: #f0b4b4; border: 1px solid #8a4444; }
h1 { margin: 0; font-size: clamp(25px, 5vw, 32px); letter-spacing: -.035em; }
.intro { margin: 10px 0 0; color: #a9b6aa; line-height: 1.55; }
footer { margin: 15px 4px 0; color: #a9b6aa; font-size: 12px; text-align: center; }
"##;

fn callback_page(success: bool) -> String {
    let (icon, kind, title, message) = if success {
        (
            "✓",
            "ok",
            "Sesión iniciada",
            "Has iniciado sesión en Laural. Ya puedes cerrar esta pestaña y volver a la aplicación.",
        )
    } else {
        (
            "!",
            "error",
            "No se pudo completar el inicio de sesión",
            "Vuelve a Laural e inténtalo de nuevo.",
        )
    };
    format!(
        r##"<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title} · Laural</title><style>{css}</style></head><body><div class="shell"><header class="brand"><div class="mark" aria-hidden="true">L</div><div><div class="brand-name">Laural</div><div class="brand-caption">Cuenta y sincronización</div></div></header><main><div class="status {kind}" aria-hidden="true">{icon}</div><h1>{title}</h1><p class="intro">{message}</p></main><footer>Laural · Acceso seguro desde navegador externo</footer></div></body></html>"##,
        title = title,
        css = CALLBACK_CSS,
        kind = kind,
        icon = icon,
        message = message
    )
}

fn write_callback_response(stream: &mut TcpStream, success: bool) {
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let body = callback_page(success);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'\r\nConnection: close\r\n\r\n{body}",
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
    read_session_credential(session_entry()?.get_password())
}

fn read_session_credential(
    credential: keyring::Result<String>,
) -> Result<Option<Zeroizing<String>>, String> {
    match credential {
        Ok(token) if valid_token(&token) => Ok(Some(Zeroizing::new(token))),
        Ok(_) => Err("La sesión guardada no tiene un formato válido.".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("No se pudo leer la sesión del almacén seguro de Windows.".into()),
    }
}

pub(crate) fn session_token() -> Result<Zeroizing<String>, String> {
    read_session()?.ok_or_else(|| "Inicia sesión para sincronizar las preferencias.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn local_response(raw_response: String) -> reqwest::Response {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request);
            stream.write_all(raw_response.as_bytes()).unwrap();
        });
        let response = reqwest::Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap();
        server.join().unwrap();
        response
    }

    fn local_api_server(raw_response: String) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let request = read_local_http_request(&mut stream);
            stream.write_all(raw_response.as_bytes()).unwrap();
            request
        });
        (format!("http://{address}"), server)
    }

    fn read_local_http_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut chunk = [0; 1024];
        loop {
            let count = stream.read(&mut chunk).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..count]);
            let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n")
            else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let body_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or_default();
            if request.len() >= header_end + 4 + body_length {
                break;
            }
        }
        String::from_utf8_lossy(&request).into_owned()
    }

    async fn local_account_sessions_request(
        raw_response: String,
    ) -> (Result<Vec<AccountSession>, String>, String) {
        let (origin, server) = local_api_server(raw_response);
        let result = request_account_sessions(
            &Client::new(),
            &format!("{origin}/v1/auth/sessions"),
            "token-de-prueba",
        )
        .await;
        (result, server.join().unwrap())
    }

    fn request(target: &str) -> Vec<u8> {
        format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").into_bytes()
    }

    #[test]
    fn solo_acepta_la_confirmacion_explicita_de_borrado() {
        assert!(valid_account_deletion_confirmation("ELIMINAR"));
        assert!(!valid_account_deletion_confirmation("eliminar"));
        assert!(!valid_account_deletion_confirmation("ELIMINAR "));
        assert!(!valid_account_deletion_confirmation(""));
    }

    #[test]
    fn informa_por_separado_los_resultados_de_limpieza_local_de_cuenta() {
        assert!(session_credential_delete_succeeded(Ok(Ok(()))));
        assert!(session_credential_delete_succeeded(Ok(Err(
            keyring::Error::NoEntry
        ))));
        assert!(!session_credential_delete_succeeded(Ok(Err(
            keyring::Error::BadEncoding(vec![0xff])
        ))));
        assert!(!session_credential_delete_succeeded(Err(
            "almacén inaccesible".into()
        )));

        assert!(sync_state_delete_succeeded(Ok(())));
        assert!(!sync_state_delete_succeeded(Err(
            "estado no disponible".into()
        )));
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
    fn rechaza_callback_sin_tokens_validos_o_con_fragmento() {
        let code = "a".repeat(43);
        let state = "b".repeat(43);
        for target in [
            format!("/callback?state={state}"),
            format!("/callback?code={code}"),
            format!("/callback?code=short&state={state}"),
            format!("/callback?code={code}&state=short"),
            format!("/callback?code={code}&state={state}#fragment"),
        ] {
            assert!(
                parse_callback(&request(&target)).is_err(),
                "se rechazó el destino {target}"
            );
        }

        let mut invalid_utf8 = request(&format!("/callback?code={code}&state={state}"));
        invalid_utf8[5] = 0xff;
        assert!(parse_callback(&invalid_utf8).is_err());
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
    fn callback_de_login_acepta_state_correcto_y_responde_con_exito() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let code = "a".repeat(43);
        let state = "b".repeat(43);
        let server = thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .write_all(&request(&format!("/callback?code={code}&state={state}")))
                .unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        });

        let accepted = receive_login_callback(listener, &"b".repeat(43), Duration::from_secs(2));

        assert_eq!(accepted.unwrap(), "a".repeat(43));
        assert!(server.join().unwrap().starts_with("HTTP/1.1 200 OK"));
    }

    #[test]
    fn callback_de_login_rechaza_cinco_state_distintos_y_caduca() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for _ in 0..5 {
                let mut stream = TcpStream::connect(address).unwrap();
                stream
                    .write_all(&request(&format!(
                        "/callback?code={}&state={}",
                        "a".repeat(43),
                        "c".repeat(43)
                    )))
                    .unwrap();
                let mut response = String::new();
                stream.read_to_string(&mut response).unwrap();
                assert!(response.starts_with("HTTP/1.1 400 Bad Request"));
            }
        });

        let result = receive_login_callback(listener, &"b".repeat(43), Duration::from_secs(2));

        assert_eq!(result, Err(CallbackFailure::Expired));
        server.join().unwrap();
    }

    #[test]
    fn callback_de_login_caduca_si_no_llega_ninguna_peticion() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();

        let result = receive_login_callback(listener, &"b".repeat(43), Duration::from_millis(10));

        assert_eq!(result, Err(CallbackFailure::Expired));
    }

    #[test]
    fn callback_local_responde_con_html_estatico_generico_y_sin_cache() {
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
        // La página del callback lleva el diseño de Laural (no texto plano):
        // estilos en línea permitidos por la CSP, marca y tarjeta.
        assert!(response.contains("style-src 'unsafe-inline'"));
        assert!(response.contains("<style>"));
        assert!(response.contains("Sesión iniciada"));
        assert!(response.contains("cerrar esta pestaña"));
        assert!(response.contains("brand-name"));
    }

    #[test]
    fn pagina_callback_error_explica_que_volver_a_laural() {
        let page = callback_page(false);
        assert!(page.contains("No se pudo completar el inicio de sesión"));
        assert!(page.contains("Vuelve a Laural e inténtalo de nuevo."));
        assert!(page.contains("status error"));
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            write_callback_response(&mut stream, false);
        });
        let mut failure_response = String::new();
        TcpStream::connect(address)
            .unwrap()
            .read_to_string(&mut failure_response)
            .unwrap();
        server.join().unwrap();

        assert!(failure_response.starts_with("HTTP/1.1 400 Bad Request"));
        assert!(failure_response.contains("No se pudo completar el inicio de sesión"));
        assert!(failure_response.contains("Cache-Control: no-store"));
        assert!(!failure_response.contains("code="));
        assert!(!failure_response.contains("state="));
    }

    #[test]
    fn emite_tokens_pkce_en_formato_url_seguro() {
        let token = random_token().unwrap();
        assert!(valid_token(&token));
        assert!(!valid_token("bad token"));
        assert!(!valid_token(&"a".repeat(42)));
        assert!(!valid_token(&"a".repeat(44)));
        assert!(!valid_token(&format!("{}+", "a".repeat(42))));
        assert!(valid_token(&format!("{}_-", "a".repeat(41))));
    }

    #[test]
    fn clasifica_resultados_de_revocacion_sin_tratar_fallos_como_confirmados() {
        assert!(remote_revocation_confirmed(reqwest::StatusCode::NO_CONTENT));
        assert!(remote_revocation_confirmed(
            reqwest::StatusCode::UNAUTHORIZED
        ));
        assert!(!remote_revocation_confirmed(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
    }

    #[test]
    fn valida_ids_de_sesion_uuid_antes_de_formar_la_ruta() {
        assert!(valid_session_id("d5363ea7-f6cb-4cca-8e03-85aa33089e7a"));
        assert!(!valid_session_id("../../v1/auth/session/revoke"));
        assert!(!valid_session_id("d5363ea7-f6cb-4cca-8e03-85aa33089e7z"));
    }

    #[test]
    fn lee_sesion_solo_si_el_token_del_almacen_tiene_formato_valido() {
        let token = "a".repeat(43);
        assert_eq!(
            read_session_credential(Ok(token.clone()))
                .unwrap()
                .unwrap()
                .as_str(),
            token
        );
        assert!(
            read_session_credential(Err(keyring::Error::NoEntry))
                .unwrap()
                .is_none()
        );
        assert_eq!(
            read_session_credential(Ok("token-invalido".into())).err(),
            Some("La sesión guardada no tiene un formato válido.".into())
        );
        assert_eq!(
            read_session_credential(Err(keyring::Error::BadEncoding(vec![0xff]))).err(),
            Some("No se pudo leer la sesión del almacén seguro de Windows.".into())
        );
    }

    #[test]
    fn valida_codigo_totp_con_seis_digitos_ascii() {
        assert!(valid_totp_code("012345"));
        assert!(!valid_totp_code("12345"));
        assert!(!valid_totp_code("1234567"));
        assert!(!valid_totp_code("１２３４５６"));
        assert!(!valid_totp_code("12 456"));
    }

    #[tokio::test]
    async fn limita_y_valida_respuestas_json_de_la_api_de_cuenta() {
        let valid = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        )
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(valid, "fallo")
                .await
                .unwrap(),
            serde_json::json!({})
        );

        let denied = local_response(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        )
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(denied, "fallo")
                .await
                .unwrap_err(),
            "fallo"
        );

        let oversized_header = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 4097\r\nConnection: close\r\n\r\n".into(),
        )
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(oversized_header, "fallo")
                .await
                .unwrap_err(),
            "fallo"
        );

        let malformed = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nno!".into(),
        )
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(malformed, "fallo")
                .await
                .unwrap_err(),
            "fallo"
        );

        let oversized_body = "x".repeat(4097);
        let response = local_response(format!(
            "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{oversized_body}"
        ))
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(response, "fallo")
                .await
                .unwrap_err(),
            "fallo"
        );

        let truncated = local_response(
            "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n{}".into(),
        )
        .await;
        assert_eq!(
            bounded_response_json::<serde_json::Value>(truncated, "fallo")
                .await
                .unwrap_err(),
            "fallo"
        );
    }

    #[tokio::test]
    async fn acepta_respuesta_json_en_el_limite_de_bytes_permitido() {
        let body = format!("\"{}\"", "x".repeat(4094));
        assert_eq!(body.len(), 4096);
        let response = local_response(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: 4096\r\nConnection: close\r\n\r\n{body}"
        ))
        .await;

        let parsed = bounded_response_json::<String>(response, "fallo")
            .await
            .unwrap();
        assert_eq!(parsed.len(), 4094);
    }

    #[tokio::test]
    async fn cliente_de_cuenta_rechaza_http_antes_de_conectar() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();

        let result = account_api_client()
            .unwrap()
            .get(format!("http://{address}/v1/auth/sessions"))
            .bearer_auth("credencial-de-prueba")
            .send()
            .await;

        assert!(result.is_err());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[tokio::test]
    async fn rechaza_codigo_totp_y_uuid_de_sesion_invalidos_antes_de_acceder_a_credenciales() {
        assert_eq!(
            confirm_totp_enrollment("12345".into()).await.unwrap_err(),
            "Introduce el código de seis dígitos de tu aplicación."
        );
        assert_eq!(
            revoke_account_session("../../session".into())
                .await
                .unwrap_err(),
            "El identificador de sesión no es válido."
        );
    }

    #[tokio::test]
    async fn consulta_sesiones_autenticadas_y_rechaza_respuestas_no_validas() {
        let body = r#"{"sessions":[{"id":"d5363ea7-f6cb-4cca-8e03-85aa33089e7a","createdAt":"2026-11-26T12:00:00Z","expiresAt":"2026-12-26T12:00:00Z","current":true}]}"#;
        let (sessions, request) = local_account_sessions_request(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ))
        .await;
        let sessions = sessions.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "d5363ea7-f6cb-4cca-8e03-85aa33089e7a");
        assert!(sessions[0].current);
        let request = request.to_ascii_lowercase();
        assert!(request.contains("get /v1/auth/sessions http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));

        let (denied, _) = local_account_sessions_request(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        )
        .await;
        assert_eq!(
            denied.err().unwrap(),
            "No se pudieron consultar las sesiones de la cuenta."
        );

        let (malformed, _) = local_account_sessions_request(
            "HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"sessions\""
                .into(),
        )
        .await;
        assert_eq!(
            malformed.err().unwrap(),
            "La respuesta de sesiones no tiene un formato válido."
        );

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let unavailable = request_account_sessions(
            &Client::new(),
            &format!("http://{address}/v1/auth/sessions"),
            "token-de-prueba",
        )
        .await;
        server.join().unwrap();
        assert_eq!(
            unavailable.err().unwrap(),
            "No se pudieron consultar las sesiones de la cuenta."
        );
    }

    #[tokio::test]
    async fn revoca_sesiones_y_valida_resultados_del_api() {
        let (origin, server) = local_api_server(
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        let id = "d5363ea7-f6cb-4cca-8e03-85aa33089e7a";
        let revoked = request_revoke_account_session(
            &Client::new(),
            &format!("{origin}/v1/auth/sessions/{id}"),
            "token-de-prueba",
        )
        .await
        .unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(revoked);
        assert!(request.contains(&format!("delete /v1/auth/sessions/{id} http/1.1")));
        assert!(request.contains("authorization: bearer token-de-prueba"));

        let (origin, server) = local_api_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        );
        assert!(
            !request_revoke_account_session(
                &Client::new(),
                &format!("{origin}/v1/auth/sessions/{id}"),
                "token-de-prueba"
            )
            .await
            .unwrap()
        );
        server.join().unwrap();

        let (origin, server) = local_api_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"revoked\":3}"
                .into(),
        );
        assert_eq!(
            request_revoke_other_account_sessions(
                &Client::new(),
                &format!("{origin}/v1/auth/sessions/revoke-others"),
                "token-de-prueba"
            )
            .await
            .unwrap(),
            3
        );
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("post /v1/auth/sessions/revoke-others http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));

        let (origin, server) = local_api_server(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        );
        let denied = request_revoke_other_account_sessions(
            &Client::new(),
            &format!("{origin}/v1/auth/sessions/revoke-others"),
            "token-de-prueba",
        )
        .await;
        assert_eq!(
            denied.err().unwrap(),
            "No se pudieron revocar las demás sesiones."
        );
        server.join().unwrap();

        let (origin, server) = local_api_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        );
        let malformed = request_revoke_other_account_sessions(
            &Client::new(),
            &format!("{origin}/v1/auth/sessions/revoke-others"),
            "token-de-prueba",
        )
        .await;
        assert_eq!(
            malformed.err().unwrap(),
            "La respuesta de revocación no tiene un formato válido."
        );
        server.join().unwrap();

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let unavailable = request_revoke_account_session(
            &Client::new(),
            &format!("http://{address}/v1/auth/sessions/{id}"),
            "token-de-prueba",
        )
        .await;
        server.join().unwrap();
        assert_eq!(
            unavailable.err().unwrap(),
            "No se pudo revocar la sesión seleccionada."
        );

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let unavailable = request_revoke_other_account_sessions(
            &Client::new(),
            &format!("http://{address}/v1/auth/sessions/revoke-others"),
            "token-de-prueba",
        )
        .await;
        server.join().unwrap();
        assert_eq!(
            unavailable.err().unwrap(),
            "No se pudieron revocar las demás sesiones."
        );
    }

    #[tokio::test]
    async fn envia_codigo_totp_y_valida_respuesta_json_autenticada() {
        let body = r#"{"recoveryCodes":["ABCD-EFGH"]}"#;
        let (origin, server) = local_api_server(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));

        let codes = request_account_json::<RecoveryCodesResponse>(
            &Client::new(),
            Method::POST,
            &format!("{origin}/v1/auth/mfa/totp/enrollment/confirm"),
            "token-de-prueba",
            Some(serde_json::json!({ "code": "123456" })),
            "error de transporte",
            "error de respuesta",
        )
        .await
        .unwrap();

        assert_eq!(codes.recovery_codes, ["ABCD-EFGH"]);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("post /v1/auth/mfa/totp/enrollment/confirm http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));
        assert!(request.contains("content-type: application/json"));
        assert!(request.contains("\"code\":\"123456\""));

        let body =
            r#"{"secret":"JBSWY3DPEHPK3PXP","provisioningUri":"otpauth://totp/Laural:test"}"#;
        let (origin, server) = local_api_server(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));
        let enrollment = request_account_json::<TotpEnrollment>(
            &Client::new(),
            Method::POST,
            &format!("{origin}/v1/auth/mfa/totp/enrollment"),
            "token-de-prueba",
            None,
            "error de transporte",
            "error de respuesta",
        )
        .await
        .unwrap();
        assert_eq!(enrollment.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(enrollment.provisioning_uri, "otpauth://totp/Laural:test");
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("post /v1/auth/mfa/totp/enrollment http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));
        assert!(!request.contains("\"code\""));

        let (origin, server) = local_api_server(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        );
        let denied = request_account_json::<RecoveryCodesResponse>(
            &Client::new(),
            Method::POST,
            &format!("{origin}/v1/auth/mfa/totp/enrollment/confirm"),
            "token-de-prueba",
            Some(serde_json::json!({ "code": "123456" })),
            "error de transporte",
            "fallo de autenticación",
        )
        .await;
        assert_eq!(denied.err().unwrap(), "fallo de autenticación");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn operaciones_totp_sin_contenido_exigen_204_y_controlan_fallos() {
        let (origin, server) = local_api_server(
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        request_account_no_content(
            &Client::new(),
            Method::DELETE,
            &format!("{origin}/v1/auth/mfa/totp"),
            "token-de-prueba",
            "error de transporte",
            "fallo de respuesta",
        )
        .await
        .unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("delete /v1/auth/mfa/totp http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));

        let (origin, server) = local_api_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".into(),
        );
        let unexpected_status = request_account_no_content(
            &Client::new(),
            Method::POST,
            &format!("{origin}/v1/auth/mfa/totp/enrollment/complete"),
            "token-de-prueba",
            "error de transporte",
            "fallo de respuesta",
        )
        .await;
        assert_eq!(unexpected_status.err().unwrap(), "fallo de respuesta");
        server.join().unwrap();

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let unavailable = request_account_no_content(
            &Client::new(),
            Method::POST,
            &format!("http://{address}/v1/auth/mfa/totp/enrollment/complete"),
            "token-de-prueba",
            "fallo de transporte",
            "fallo de respuesta",
        )
        .await;
        assert_eq!(unavailable.err().unwrap(), "fallo de transporte");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn solicita_enlace_passkey_autenticado_y_rechaza_respuestas_no_seguras() {
        let ticket = "a".repeat(43);
        let url = format!("{SYNC_ORIGIN}/auth/passkeys/manage#ticket={ticket}");
        let body = serde_json::json!({ "url": url }).to_string();
        let (origin, server) = local_api_server(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));
        let link = request_passkey_management_url(
            &Client::new(),
            &format!("{origin}/v1/auth/passkeys/manage-link"),
            "token-de-prueba",
        )
        .await
        .unwrap();
        assert_eq!(link.as_str(), url);
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("post /v1/auth/passkeys/manage-link http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));

        let (origin, server) = local_api_server(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        let forbidden = request_passkey_management_url(
            &Client::new(),
            &format!("{origin}/v1/auth/passkeys/manage-link"),
            "token-de-prueba",
        )
        .await;
        assert_eq!(
            forbidden.err().unwrap(),
            "Vuelve a iniciar sesión para gestionar tus passkeys."
        );
        server.join().unwrap();

        let attacker_url = format!("https://attacker.example/auth/passkeys/manage#ticket={ticket}");
        let body = serde_json::json!({ "url": attacker_url }).to_string();
        let (origin, server) = local_api_server(format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ));
        let untrusted_link = request_passkey_management_url(
            &Client::new(),
            &format!("{origin}/v1/auth/passkeys/manage-link"),
            "token-de-prueba",
        )
        .await;
        assert_eq!(
            untrusted_link.err().unwrap(),
            "El servicio devolvió un enlace de passkeys no permitido."
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn borrado_de_cuenta_exige_sesion_reciente_y_confirmacion_explicita() {
        let (origin, server) = local_api_server(
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        request_account_deletion(
            &Client::new(),
            &format!("{origin}/v1/auth/account"),
            "token-de-prueba",
            "ELIMINAR",
        )
        .await
        .unwrap();
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.contains("delete /v1/auth/account http/1.1"));
        assert!(request.contains("authorization: bearer token-de-prueba"));
        assert!(request.contains("\"confirmation\":\"eliminar\""));

        let (origin, server) = local_api_server(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        );
        let stale_session = request_account_deletion(
            &Client::new(),
            &format!("{origin}/v1/auth/account"),
            "token-de-prueba",
            "ELIMINAR",
        )
        .await;
        assert_eq!(
            stale_session.err().unwrap(),
            "La sesión ya no es reciente. Vuelve a iniciar sesión y confirma el borrado dentro de los diez minutos siguientes."
        );
        server.join().unwrap();

        let (origin, server) = local_api_server(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .into(),
        );
        let failed = request_account_deletion(
            &Client::new(),
            &format!("{origin}/v1/auth/account"),
            "token-de-prueba",
            "ELIMINAR",
        )
        .await;
        assert_eq!(
            failed.err().unwrap(),
            "No se pudo borrar la cuenta. Comprueba la sesión e inténtalo de nuevo."
        );
        server.join().unwrap();

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let unavailable = request_account_deletion(
            &Client::new(),
            &format!("http://{address}/v1/auth/account"),
            "token-de-prueba",
            "ELIMINAR",
        )
        .await;
        assert_eq!(
            unavailable.err().unwrap(),
            "No se pudo confirmar el borrado de la cuenta. Comprueba la conexión antes de volver a intentarlo."
        );
        server.join().unwrap();
    }

    #[test]
    fn limita_la_lectura_del_callback_local_y_rechaza_cierre_incompleto() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .write_all(&vec![b'x'; MAX_CALLBACK_BYTES + 1])
                .unwrap();
        });
        let mut stream = TcpStream::connect(address).unwrap();
        assert!(read_callback_request(&mut stream).is_err());
        server.join().unwrap();

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            drop(stream);
        });
        let mut stream = TcpStream::connect(address).unwrap();
        assert!(read_callback_request(&mut stream).is_err());
        server.join().unwrap();
    }

    #[test]
    fn acepta_callback_local_que_ocupa_exactamente_el_limite_de_bytes() {
        let code = "a".repeat(43);
        let state = "b".repeat(43);
        let mut request = format!(
            "GET /callback?code={code}&state={state} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Padding: "
        )
        .into_bytes();
        let ending = b"\r\n\r\n";
        let padding_length = MAX_CALLBACK_BYTES - request.len() - ending.len();
        request.extend(std::iter::repeat_n(b'x', padding_length));
        request.extend_from_slice(ending);
        assert_eq!(request.len(), MAX_CALLBACK_BYTES);

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.write_all(&request).unwrap();
        });
        let mut stream = TcpStream::connect(address).unwrap();

        let received = read_callback_request(&mut stream).unwrap();
        server.join().unwrap();
        assert_eq!(received.len(), MAX_CALLBACK_BYTES);
        assert_eq!(parse_callback(&received).unwrap(), (code, state));
    }

    #[test]
    fn limita_el_enlace_de_gestion_de_passkeys_al_vps_y_ticket_opaco() {
        let valid = Url::parse(&format!(
            "{SYNC_ORIGIN}/auth/passkeys/manage#ticket={}",
            "a".repeat(43)
        ))
        .unwrap();
        assert!(is_allowed_passkey_management_url(&valid));
        for value in [
            format!(
                "https://attacker.test/auth/passkeys/manage?ticket={}",
                "a".repeat(43)
            ),
            format!("{SYNC_ORIGIN}/other?ticket={}", "a".repeat(43)),
            format!("{SYNC_ORIGIN}/auth/passkeys/manage#ticket=short"),
            format!(
                "{SYNC_ORIGIN}/auth/passkeys/manage#ticket={}&extra=1",
                "a".repeat(43)
            ),
            format!(
                "{SYNC_ORIGIN}/auth/passkeys/manage?ticket={}",
                "a".repeat(43)
            ),
            format!(
                "https://usuario@sync.laurafernandezenfermeria.com/auth/passkeys/manage#ticket={}",
                "a".repeat(43)
            ),
            format!(
                "https://:clave@sync.laurafernandezenfermeria.com/auth/passkeys/manage#ticket={}",
                "a".repeat(43)
            ),
        ] {
            assert!(!is_allowed_passkey_management_url(
                &Url::parse(&value).unwrap()
            ));
        }
    }
}
