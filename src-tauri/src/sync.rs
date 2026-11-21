use std::{fs, path::PathBuf, sync::OnceLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, Response, redirect::Policy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, command};

use crate::{
    account::{self, SYNC_ORIGIN},
    preferences::snapshot::{self, MAX_SNAPSHOT_BYTES, PreferenceSnapshot},
};

const MAX_RESPONSE_BYTES: usize = MAX_SNAPSHOT_BYTES + 1024;
const MAX_SYNC_STATE_BYTES: usize = (MAX_SNAPSHOT_BYTES * 2) + 2048;
const SYNC_STATE_FILE: &str = "preference-sync-state.json";
static SYNC_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteSnapshot {
    pub snapshot: Option<PreferenceSnapshot>,
    pub revision: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncState {
    local_snapshot: Option<PreferenceSnapshot>,
    cloud_snapshot: Option<PreferenceSnapshot>,
    revision: Option<u64>,
    pending: bool,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SyncRunResult {
    Synced { revision: u64 },
    Pending,
    NeedsChoice,
    Conflict,
    SignedOut,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncStatus {
    configured: bool,
    pending: bool,
}

#[derive(Debug, Eq, PartialEq)]
enum SyncDecision {
    AlreadyEqual,
    NeedsChoice,
    Conflict,
    Upload,
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
    fetch_remote_preferences(&token).await
}

async fn fetch_remote_preferences(token: &str) -> Result<RemoteSnapshot, String> {
    let client = sync_client()?;
    let response = client
        .get(format!("{SYNC_ORIGIN}/v1/preferences/current"))
        .bearer_auth(token)
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
    app: AppHandle,
    snapshot: PreferenceSnapshot,
    revision: u64,
) -> Result<RemoteWriteResult, String> {
    let _guard = lock_sync().await;
    let token = account::session_token()?;
    let result = put_remote_preferences(&token, &snapshot, revision).await?;
    if let RemoteWriteResult::Saved { revision } = result {
        record_sync_baseline(&app, snapshot.clone(), snapshot, revision)?;
        return Ok(RemoteWriteResult::Saved { revision });
    }
    Ok(result)
}

#[command]
pub async fn confirm_remote_preferences(
    app: AppHandle,
    snapshot: PreferenceSnapshot,
    revision: u64,
) -> Result<bool, String> {
    snapshot::encode(&snapshot)?;
    let _guard = lock_sync().await;
    let token = account::session_token()?;
    let remote = fetch_remote_preferences(&token).await?;
    if remote.revision != revision || remote.snapshot.as_ref() != Some(&snapshot) {
        return Ok(false);
    }
    record_sync_baseline(&app, snapshot.clone(), snapshot, revision)?;
    Ok(true)
}

#[command]
pub async fn sync_local_preferences(
    app: AppHandle,
    snapshot: PreferenceSnapshot,
) -> Result<SyncRunResult, String> {
    snapshot::encode(&snapshot)?;
    let _guard = lock_sync().await;
    let token = match account::session_token() {
        Ok(token) => token,
        Err(_) => return Ok(SyncRunResult::SignedOut),
    };
    let state = read_sync_state(&app)?;
    let remote = match fetch_remote_preferences(&token).await {
        Ok(remote) => remote,
        Err(_) => {
            mark_sync_pending(&app)?;
            return Ok(SyncRunResult::Pending);
        }
    };

    match decide_sync(state.as_ref(), &remote, &snapshot) {
        SyncDecision::AlreadyEqual => {
            let cloud_snapshot = remote.snapshot.clone().unwrap_or_else(|| snapshot.clone());
            record_sync_baseline(&app, snapshot, cloud_snapshot, remote.revision)?;
            return Ok(SyncRunResult::Synced {
                revision: remote.revision,
            });
        }
        SyncDecision::NeedsChoice => {
            mark_sync_pending(&app)?;
            return Ok(SyncRunResult::NeedsChoice);
        }
        SyncDecision::Conflict => {
            mark_sync_pending(&app)?;
            return Ok(SyncRunResult::Conflict);
        }
        SyncDecision::Upload => {}
    }

    let previous_local = state
        .as_ref()
        .and_then(|sync_state| sync_state.local_snapshot.as_ref());
    let cloud_snapshot = preserve_unshared_endpoints(&snapshot, &remote.snapshot, previous_local)?;
    let write_result = match put_remote_preferences(&token, &cloud_snapshot, remote.revision).await
    {
        Ok(result) => result,
        Err(_) => {
            mark_sync_pending(&app)?;
            return Ok(SyncRunResult::Pending);
        }
    };
    match write_result {
        RemoteWriteResult::Saved { revision } => {
            record_sync_baseline(&app, snapshot, cloud_snapshot, revision)?;
            Ok(SyncRunResult::Synced { revision })
        }
        RemoteWriteResult::Conflict => {
            mark_sync_pending(&app)?;
            Ok(SyncRunResult::Conflict)
        }
    }
}

fn decide_sync(
    state: Option<&SyncState>,
    remote: &RemoteSnapshot,
    local: &PreferenceSnapshot,
) -> SyncDecision {
    if remote.snapshot.as_ref() == Some(local) {
        return SyncDecision::AlreadyEqual;
    }
    let Some(state) = state else {
        return SyncDecision::NeedsChoice;
    };
    let (Some(previous_revision), Some(local_snapshot), Some(cloud_snapshot)) = (
        state.revision,
        state.local_snapshot.as_ref(),
        state.cloud_snapshot.as_ref(),
    ) else {
        return SyncDecision::NeedsChoice;
    };
    if remote.revision != previous_revision || remote.snapshot.as_ref() != Some(cloud_snapshot) {
        return SyncDecision::Conflict;
    }
    if local_snapshot == local {
        SyncDecision::AlreadyEqual
    } else {
        SyncDecision::Upload
    }
}

#[command]
pub fn get_preference_sync_status(app: AppHandle) -> Result<LocalSyncStatus, String> {
    let state = read_sync_state(&app)?;
    Ok(LocalSyncStatus {
        configured: state
            .as_ref()
            .is_some_and(|value| value.local_snapshot.is_some()),
        pending: state.is_some_and(|value| value.pending),
    })
}

pub(crate) async fn verify_remote_snapshot(
    snapshot: &PreferenceSnapshot,
    revision: u64,
) -> Result<(), String> {
    let token = account::session_token()?;
    let remote = fetch_remote_preferences(&token).await?;
    if remote.revision != revision || remote.snapshot.as_ref() != Some(snapshot) {
        return Err(
            "La nube cambió desde la comparación. Vuelve a sincronizar antes de aplicar.".into(),
        );
    }
    Ok(())
}

pub(crate) fn record_sync_baseline(
    app: &AppHandle,
    local_snapshot: PreferenceSnapshot,
    cloud_snapshot: PreferenceSnapshot,
    revision: u64,
) -> Result<(), String> {
    snapshot::encode(&local_snapshot)?;
    snapshot::encode(&cloud_snapshot)?;
    write_sync_state(
        app,
        &SyncState {
            local_snapshot: Some(local_snapshot),
            cloud_snapshot: Some(cloud_snapshot),
            revision: Some(revision),
            pending: false,
        },
    )
}

pub(crate) async fn lock_sync() -> tokio::sync::MutexGuard<'static, ()> {
    sync_lock().lock().await
}

fn sync_lock() -> &'static tokio::sync::Mutex<()> {
    SYNC_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn sync_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "No se pudo localizar la carpeta de sincronización.".to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|_| "No se pudo preparar el estado local de sincronización.".to_string())?;
    Ok(directory.join(SYNC_STATE_FILE))
}

fn read_sync_state(app: &AppHandle) -> Result<Option<SyncState>, String> {
    let path = sync_state_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path)
        .map_err(|_| "No se pudo leer el estado local de sincronización.".to_string())?;
    if bytes.len() > MAX_SYNC_STATE_BYTES {
        return Err("El estado local de sincronización supera el límite permitido.".into());
    }
    let state: SyncState = serde_json::from_slice(&bytes)
        .map_err(|_| "El estado local de sincronización no es válido.".to_string())?;
    if let Some(snapshot) = &state.local_snapshot {
        snapshot::encode(snapshot)?;
    }
    if let Some(snapshot) = &state.cloud_snapshot {
        snapshot::encode(snapshot)?;
    }
    let has_local_snapshot = state.local_snapshot.is_some();
    if state.revision.is_some() != has_local_snapshot
        || has_local_snapshot != state.cloud_snapshot.is_some()
    {
        return Err("El estado local de sincronización está incompleto.".into());
    }
    Ok(Some(state))
}

fn write_sync_state(app: &AppHandle, state: &SyncState) -> Result<(), String> {
    let path = sync_state_path(app)?;
    let bytes = serde_json::to_vec(state)
        .map_err(|_| "No se pudo guardar el estado local de sincronización.".to_string())?;
    if bytes.len() > MAX_SYNC_STATE_BYTES {
        return Err("El estado local de sincronización supera el límite permitido.".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "No se pudo localizar la carpeta de sincronización.".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "No se pudo preparar el estado de sincronización.".to_string())?;
    std::io::Write::write_all(&mut temporary, &bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "No se pudo escribir el estado de sincronización.".to_string())?;
    temporary
        .persist(path)
        .map_err(|_| "No se pudo actualizar el estado de sincronización.".to_string())?;
    Ok(())
}

fn mark_sync_pending(app: &AppHandle) -> Result<(), String> {
    let mut state = read_sync_state(app)?.unwrap_or(SyncState {
        local_snapshot: None,
        cloud_snapshot: None,
        revision: None,
        pending: false,
    });
    state.pending = true;
    write_sync_state(app, &state)
}

fn preserve_unshared_endpoints(
    local: &PreferenceSnapshot,
    cloud: &Option<PreferenceSnapshot>,
    previous_local: Option<&PreferenceSnapshot>,
) -> Result<PreferenceSnapshot, String> {
    let mut outgoing = local.clone();
    let Some(cloud) = cloud else {
        return Ok(outgoing);
    };
    let cloud_by_id: std::collections::HashMap<
        &str,
        &crate::preferences::snapshot::SnapshotProvider,
    > = cloud
        .providers
        .iter()
        .map(|provider| (provider.id.as_str(), provider))
        .collect();
    for provider in &mut outgoing.providers {
        if provider.custom_endpoint.is_none() {
            let was_shared_locally = previous_local
                .and_then(|previous| {
                    previous
                        .providers
                        .iter()
                        .find(|item| item.id == provider.id)
                })
                .is_some_and(|previous| previous.custom_endpoint.is_some());
            if was_shared_locally {
                continue;
            }
            provider.custom_endpoint = cloud_by_id
                .get(provider.id.as_str())
                .and_then(|remote| remote.custom_endpoint.clone());
        }
    }
    snapshot::decode(&snapshot::encode(&outgoing)?)
}

async fn put_remote_preferences(
    token: &str,
    snapshot: &PreferenceSnapshot,
    revision: u64,
) -> Result<RemoteWriteResult, String> {
    let body = snapshot::encode(snapshot)?;
    let idempotency_key = random_idempotency_key()?;
    let client = sync_client()?;
    let response = client
        .put(format!("{SYNC_ORIGIN}/v1/preferences/current"))
        .bearer_auth(token)
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
    if saved.revision != saved_revision || saved.snapshot.as_ref() != Some(snapshot) {
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

    fn snapshot(theme_id: &str) -> PreferenceSnapshot {
        PreferenceSnapshot {
            schema_version: 1,
            preferences: crate::preferences::snapshot::SnapshotPreferences {
                theme_id: theme_id.into(),
                appearance: "dark".into(),
                update_mode: "manual".into(),
            },
            active_provider_id: None,
            providers: Vec::new(),
        }
    }

    fn state(revision: u64, baseline_snapshot: PreferenceSnapshot) -> SyncState {
        SyncState {
            local_snapshot: Some(baseline_snapshot.clone()),
            cloud_snapshot: Some(baseline_snapshot),
            revision: Some(revision),
            pending: false,
        }
    }

    #[test]
    fn exige_eleccion_para_la_primera_diferencia_y_detecta_cambios_remotos() {
        let local = snapshot("laurel");
        let cloud = snapshot("ocean");
        let empty_remote = RemoteSnapshot {
            snapshot: None,
            revision: 0,
        };
        assert_eq!(
            decide_sync(None, &empty_remote, &local),
            SyncDecision::NeedsChoice
        );

        let remote = RemoteSnapshot {
            snapshot: Some(cloud.clone()),
            revision: 5,
        };
        assert_eq!(
            decide_sync(None, &remote, &local),
            SyncDecision::NeedsChoice
        );
        assert_eq!(
            decide_sync(Some(&state(4, local.clone())), &remote, &local),
            SyncDecision::Conflict
        );
    }

    #[test]
    fn solo_sube_cambios_locales_si_la_revision_remota_sigue_en_su_linea_base() {
        let baseline = snapshot("laurel");
        let local = snapshot("ocean");
        let remote = RemoteSnapshot {
            snapshot: Some(baseline.clone()),
            revision: 8,
        };
        assert_eq!(
            decide_sync(Some(&state(8, baseline.clone())), &remote, &local),
            SyncDecision::Upload
        );
        assert_eq!(
            decide_sync(Some(&state(8, baseline.clone())), &remote, &baseline),
            SyncDecision::AlreadyEqual
        );
        assert_eq!(
            decide_sync(
                Some(&state(8, baseline.clone())),
                &RemoteSnapshot {
                    snapshot: Some(local.clone()),
                    revision: 8,
                },
                &local
            ),
            SyncDecision::AlreadyEqual
        );
    }

    #[test]
    fn conserva_endpoint_compartido_en_cloud_si_este_equipo_no_autorizo_recompartirlo() {
        let provider = |endpoint| crate::preferences::snapshot::SnapshotProvider {
            id: "perfil".into(),
            kind: "custom".into(),
            name: "Servidor".into(),
            model: "modelo".into(),
            custom_endpoint: endpoint,
        };
        let mut local = snapshot("ocean");
        local.active_provider_id = Some("perfil".into());
        local.providers.push(provider(None));
        let mut cloud = snapshot("laurel");
        cloud.active_provider_id = Some("perfil".into());
        cloud
            .providers
            .push(provider(Some("https://llm.example/v1".into())));

        let outgoing =
            preserve_unshared_endpoints(&local, &Some(cloud.clone()), Some(&local)).unwrap();
        assert_eq!(outgoing.preferences.theme_id, "ocean");
        assert_eq!(
            outgoing.providers[0].custom_endpoint.as_deref(),
            Some("https://llm.example/v1")
        );
        let baseline = SyncState {
            local_snapshot: Some(local.clone()),
            cloud_snapshot: Some(cloud.clone()),
            revision: Some(12),
            pending: false,
        };
        assert_eq!(
            decide_sync(
                Some(&baseline),
                &RemoteSnapshot {
                    snapshot: Some(cloud.clone()),
                    revision: 12,
                },
                &local,
            ),
            SyncDecision::AlreadyEqual
        );

        let mut previously_shared = local.clone();
        previously_shared.providers[0].custom_endpoint = Some("https://llm.example/v1".into());
        let revoked =
            preserve_unshared_endpoints(&local, &Some(cloud), Some(&previously_shared)).unwrap();
        assert_eq!(revoked.providers[0].custom_endpoint, None);
    }

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
