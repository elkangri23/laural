use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, Response, redirect::Policy};
use serde::{Deserialize, Serialize};
use tauri::command;

use crate::{
    account::{self, SYNC_ORIGIN},
    preferences::snapshot::{self, MAX_SNAPSHOT_BYTES, PreferenceSnapshot},
};

const MAX_RESPONSE_BYTES: usize = MAX_SNAPSHOT_BYTES + 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteSnapshot {
    pub snapshot: Option<PreferenceSnapshot>,
    pub revision: u64,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum RemoteWriteResult {
    Saved { revision: u64 },
    Conflict,
}

#[command]
pub async fn read_remote_preferences() -> Result<RemoteSnapshot, String> {
    let token = account::session_token()?;
    let client = sync_client()?;
    let response = client
        .get(format!("{SYNC_ORIGIN}/v1/preferences/current"))
        .bearer_auth(&*token)
        .send()
        .await
        .map_err(|_| "No se pudo consultar la configuración en la nube.".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("La sesión no es válida o ha caducado. Inicia sesión de nuevo.".into());
    }
    if !response.status().is_success() {
        return Err("El servicio no pudo leer la configuración sincronizada.".into());
    }
    let revision = etag_revision(&response)?;
    let bytes = bounded_body(response).await?;
    let remote: RemoteSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "El servicio devolvió una configuración inválida.".to_string())?;
    if remote.revision != revision {
        return Err("La revisión del servicio no coincide con su respuesta.".into());
    }
    if let Some(snapshot) = &remote.snapshot {
        snapshot::encode(snapshot)?;
    }
    Ok(remote)
}

#[command]
pub async fn write_remote_preferences(
    snapshot: PreferenceSnapshot,
    revision: u64,
) -> Result<RemoteWriteResult, String> {
    let body = snapshot::encode(&snapshot)?;
    let token = account::session_token()?;
    let idempotency_key = random_idempotency_key()?;
    let client = sync_client()?;
    let response = client
        .put(format!("{SYNC_ORIGIN}/v1/preferences/current"))
        .bearer_auth(&*token)
        .header(reqwest::header::IF_MATCH, format!("\"{revision}\""))
        .header("Idempotency-Key", idempotency_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "No se pudo guardar la configuración en la nube.".to_string())?;

    if response.status() == reqwest::StatusCode::PRECONDITION_FAILED {
        return Ok(RemoteWriteResult::Conflict);
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("La sesión no es válida o ha caducado. Inicia sesión de nuevo.".into());
    }
    if response.status() == reqwest::StatusCode::CONFLICT {
        return Err(
            "El servicio rechazó la clave de idempotencia; vuelve a consultar la nube.".into(),
        );
    }
    if !response.status().is_success() {
        return Err("El servicio no pudo guardar la configuración.".into());
    }
    let saved_revision = etag_revision(&response)?;
    let bytes = bounded_body(response).await?;
    let saved: RemoteSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "El servicio devolvió una confirmación inválida.".to_string())?;
    if saved.revision != saved_revision || saved.snapshot.as_ref() != Some(&snapshot) {
        return Err("La confirmación de guardado no coincide con la configuración enviada.".into());
    }
    Ok(RemoteWriteResult::Saved {
        revision: saved_revision,
    })
}

fn sync_client() -> Result<Client, String> {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "No se pudo preparar la conexión segura de sincronización.".to_string())
}

fn etag_revision(response: &Response) -> Result<u64, String> {
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "El servicio no devolvió una revisión válida.".to_string())?;
    parse_etag_revision(etag)
        .ok_or_else(|| "El servicio no devolvió una revisión válida.".to_string())
}

fn parse_etag_revision(etag: &str) -> Option<u64> {
    etag.strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .filter(|value| {
            !value.is_empty()
                && (*value == "0" || !value.starts_with('0'))
                && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .and_then(|value| value.parse::<u64>().ok())
}

async fn bounded_body(response: Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_RESPONSE_BYTES)
    {
        return Err("La respuesta de sincronización supera el límite permitido.".into());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::with_capacity(1024);
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| "No se pudo leer la respuesta de sincronización.".to_string())?;
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("La respuesta de sincronización supera el límite permitido.".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn random_idempotency_key() -> Result<String, String> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes)
        .map_err(|_| "No se pudo generar una clave segura para sincronizar.".to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valida_etag_y_acepta_revision_cero_o_positiva() {
        assert_eq!(parse_etag_revision("\"0\""), Some(0));
        assert_eq!(parse_etag_revision("\"42\""), Some(42));
        for value in ["0", "\"\"", "\"01\"", "\"-1\"", "\"1\"x", "\"x\""] {
            assert_eq!(parse_etag_revision(value), None, "{value}");
        }
    }

    #[test]
    fn genera_claves_de_idempotencia_compatibles_con_el_api() {
        let key = random_idempotency_key().unwrap();
        assert!((16..=128).contains(&key.len()));
        assert!(
            key.bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        );
    }
}
