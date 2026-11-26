use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};

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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceHistoryPage {
    pub entries: Vec<PreferenceHistorySummary>,
    pub next_before: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceHistorySummary {
    pub revision: u64,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncState {
    local_snapshot: Option<PreferenceSnapshot>,
    cloud_snapshot: Option<PreferenceSnapshot>,
    revision: Option<u64>,
    pending: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApiError {
    error: String,
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

#[command]
pub async fn read_remote_preference_history(
    before_revision: Option<u64>,
) -> Result<PreferenceHistoryPage, String> {
    let token = account::session_token()?;
    read_remote_preference_history_with(
        &sync_client()?,
        preference_history_url(before_revision),
        token.as_str(),
    )
    .await
}

fn preference_history_url(before_revision: Option<u64>) -> String {
    let mut url = format!("{SYNC_ORIGIN}/v1/preferences/history?limit=25");
    if let Some(before) = before_revision {
        url.push_str(&format!("&before={before}"));
    }
    url
}

async fn read_remote_preference_history_with(
    client: &Client,
    url: String,
    token: &str,
) -> Result<PreferenceHistoryPage, String> {
    let response = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudo consultar el historial de preferencias.".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("La sesión no es válida o ha caducado. Inicia sesión de nuevo.".into());
    }
    if !response.status().is_success() {
        return Err("El servicio no pudo leer el historial de preferencias.".into());
    }
    serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| "El servicio devolvió un historial inválido.".to_string())
}

#[command]
pub async fn delete_remote_preference_history(revision: u64) -> Result<(), String> {
    let token = account::session_token()?;
    delete_remote_preference_history_with(
        &sync_client()?,
        format!("{SYNC_ORIGIN}/v1/preferences/history/{revision}"),
        token.as_str(),
    )
    .await
}

async fn delete_remote_preference_history_with(
    client: &Client,
    url: String,
    token: &str,
) -> Result<(), String> {
    let response = client
        .delete(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "No se pudo eliminar la versión de la nube.".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("La sesión no es válida o ha caducado. Inicia sesión de nuevo.".into());
    }
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("La versión ya no está disponible.".into());
    }
    if !response.status().is_success() {
        return Err("El servicio no pudo eliminar la versión.".into());
    }
    Ok(())
}

#[command]
pub async fn restore_remote_preference_history(
    revision: u64,
    current_revision: u64,
) -> Result<RemoteSnapshot, String> {
    let _guard = lock_sync().await;
    let token = account::session_token()?;
    restore_remote_preference_history_with(
        &sync_client()?,
        format!("{SYNC_ORIGIN}/v1/preferences/history/{revision}/restore"),
        token.as_str(),
        current_revision,
    )
    .await
}

async fn restore_remote_preference_history_with(
    client: &Client,
    url: String,
    token: &str,
    current_revision: u64,
) -> Result<RemoteSnapshot, String> {
    let idempotency_key = random_idempotency_key()?;
    let response = client
        .post(url)
        .bearer_auth(token)
        .header(reqwest::header::IF_MATCH, format!("\"{current_revision}\""))
        .header("Idempotency-Key", idempotency_key)
        .send()
        .await
        .map_err(|_| "No se pudo restaurar la versión de la nube.".to_string())?;
    if response.status() == reqwest::StatusCode::PRECONDITION_FAILED {
        return Err(
            "La nube cambió desde que cargaste el historial. Actualízalo antes de restaurar."
                .into(),
        );
    }
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("La sesión no es válida o ha caducado. Inicia sesión de nuevo.".into());
    }
    if !response.status().is_success() {
        return Err("El servicio no pudo restaurar esa versión.".into());
    }
    let response_revision = etag_revision(&response)?;
    let restored: RemoteSnapshot = serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| "El servicio devolvió una configuración inválida.".to_string())?;
    if restored.revision != response_revision {
        return Err("La revisión restaurada no coincide con la respuesta del servicio.".into());
    }
    let snapshot = restored
        .snapshot
        .as_ref()
        .ok_or_else(|| "La versión restaurada está vacía.".to_string())?;
    snapshot::encode(snapshot)?;
    Ok(restored)
}

async fn fetch_remote_preferences(token: &str) -> Result<RemoteSnapshot, String> {
    let client = sync_client()?;
    fetch_remote_preferences_with(
        &client,
        format!("{SYNC_ORIGIN}/v1/preferences/current"),
        token,
    )
    .await
}

async fn fetch_remote_preferences_with(
    client: &Client,
    url: String,
    token: &str,
) -> Result<RemoteSnapshot, String> {
    let response = client
        .get(url)
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
    let result = match put_remote_preferences(&token, &snapshot, revision).await {
        Ok(result) => result,
        Err(error) => {
            mark_sync_pending(&app)?;
            return Err(error);
        }
    };
    finalize_remote_write(result, &snapshot, |written_snapshot, revision| {
        record_sync_baseline(
            &app,
            written_snapshot.clone(),
            written_snapshot.clone(),
            revision,
        )
    })
}

fn finalize_remote_write(
    result: RemoteWriteResult,
    snapshot: &PreferenceSnapshot,
    persist_baseline: impl FnOnce(&PreferenceSnapshot, u64) -> Result<(), String>,
) -> Result<RemoteWriteResult, String> {
    match result {
        RemoteWriteResult::Saved { revision } => {
            persist_baseline(snapshot, revision)?;
            Ok(RemoteWriteResult::Saved { revision })
        }
        RemoteWriteResult::Conflict => Ok(RemoteWriteResult::Conflict),
    }
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
    finalize_remote_confirmation(remote, snapshot, revision, |local, cloud, revision| {
        record_sync_baseline(&app, local, cloud, revision)
    })
}

fn finalize_remote_confirmation(
    remote: RemoteSnapshot,
    expected: PreferenceSnapshot,
    revision: u64,
    persist_baseline: impl FnOnce(PreferenceSnapshot, PreferenceSnapshot, u64) -> Result<(), String>,
) -> Result<bool, String> {
    let remote_snapshot = match confirmed_cloud_snapshot(remote, &expected, revision) {
        Some(snapshot) => snapshot,
        None => return Ok(false),
    };
    persist_baseline(expected, remote_snapshot, revision)?;
    Ok(true)
}

fn confirmed_cloud_snapshot(
    remote: RemoteSnapshot,
    expected: &PreferenceSnapshot,
    revision: u64,
) -> Option<PreferenceSnapshot> {
    if remote.revision != revision {
        return None;
    }
    let snapshot = remote.snapshot?;
    snapshot::snapshots_equivalent(&snapshot, expected).then_some(snapshot)
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
    let write_result = put_remote_preferences(&token, &cloud_snapshot, remote.revision).await;
    complete_sync_upload(
        write_result,
        snapshot,
        cloud_snapshot,
        |local, cloud, revision| record_sync_baseline(&app, local, cloud, revision),
        || mark_sync_pending(&app),
    )
}

fn complete_sync_upload(
    write_result: Result<RemoteWriteResult, String>,
    local_snapshot: PreferenceSnapshot,
    cloud_snapshot: PreferenceSnapshot,
    persist_baseline: impl FnOnce(PreferenceSnapshot, PreferenceSnapshot, u64) -> Result<(), String>,
    mark_pending: impl FnOnce() -> Result<(), String>,
) -> Result<SyncRunResult, String> {
    let write_result = match write_result {
        Ok(result) => result,
        Err(_) => {
            mark_pending()?;
            return Ok(SyncRunResult::Pending);
        }
    };
    match write_result {
        RemoteWriteResult::Saved { revision } => {
            persist_baseline(local_snapshot, cloud_snapshot, revision)?;
            Ok(SyncRunResult::Synced { revision })
        }
        RemoteWriteResult::Conflict => {
            mark_pending()?;
            Ok(SyncRunResult::Conflict)
        }
    }
}

fn decide_sync(
    state: Option<&SyncState>,
    remote: &RemoteSnapshot,
    local: &PreferenceSnapshot,
) -> SyncDecision {
    if remote
        .snapshot
        .as_ref()
        .is_some_and(|remote| snapshot::snapshots_equivalent(remote, local))
    {
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
    if remote.revision != previous_revision
        || !remote
            .snapshot
            .as_ref()
            .is_some_and(|remote| snapshot::snapshots_equivalent(remote, cloud_snapshot))
    {
        return SyncDecision::Conflict;
    }
    if snapshot::snapshots_equivalent(local_snapshot, local) {
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

pub(crate) async fn forget_local_preference_sync_state(app: &AppHandle) -> Result<(), String> {
    let _guard = lock_sync().await;
    let path = sync_state_path(app)?;
    forget_sync_state_file(&path)
}

fn forget_sync_state_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("No se pudo borrar el estado local de sincronización de la cuenta.".into()),
    }
}

pub(crate) async fn verify_remote_snapshot(
    snapshot: &PreferenceSnapshot,
    revision: u64,
) -> Result<(), String> {
    let token = account::session_token()?;
    let remote = fetch_remote_preferences(&token).await?;
    validate_remote_snapshot(&remote, snapshot, revision)
}

fn validate_remote_snapshot(
    remote: &RemoteSnapshot,
    expected: &PreferenceSnapshot,
    revision: u64,
) -> Result<(), String> {
    let matches = remote.revision == revision
        && remote
            .snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot::snapshots_equivalent(snapshot, expected));
    if matches {
        Ok(())
    } else {
        Err("La nube cambió desde la comparación. Vuelve a sincronizar antes de aplicar.".into())
    }
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
    read_sync_state_file(&path)
}

fn read_sync_state_file(path: &Path) -> Result<Option<SyncState>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path)
        .map_err(|_| "No se pudo leer el estado local de sincronización.".to_string())?;
    parse_sync_state(&bytes).map(Some)
}

fn parse_sync_state(bytes: &[u8]) -> Result<SyncState, String> {
    if bytes.len() > MAX_SYNC_STATE_BYTES {
        return Err("El estado local de sincronización supera el límite permitido.".into());
    }
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| "El estado local de sincronización no es válido.".to_string())?;
    let fields = value
        .as_object()
        .ok_or_else(|| "El estado local de sincronización no es válido.".to_string())?;
    if !["localSnapshot", "cloudSnapshot", "revision", "pending"]
        .iter()
        .all(|field| fields.contains_key(*field))
    {
        return Err("El estado local de sincronización no es válido.".into());
    }
    let state: SyncState = serde_json::from_value(value)
        .map_err(|_| "El estado local de sincronización no es válido.".to_string())?;
    validate_sync_state(state)
}

fn validate_sync_state(state: SyncState) -> Result<SyncState, String> {
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
    Ok(state)
}

fn write_sync_state(app: &AppHandle, state: &SyncState) -> Result<(), String> {
    let path = sync_state_path(app)?;
    write_sync_state_file(&path, state)
}

fn write_sync_state_file(path: &Path, state: &SyncState) -> Result<(), String> {
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
    write_sync_state(app, &pending_sync_state(read_sync_state(app)?))
}

fn pending_sync_state(state: Option<SyncState>) -> SyncState {
    match state {
        Some(mut state) => {
            state.pending = true;
            state
        }
        None => SyncState {
            local_snapshot: None,
            cloud_snapshot: None,
            revision: None,
            pending: true,
        },
    }
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
    let client = sync_client()?;
    put_remote_preferences_with(
        &client,
        format!("{SYNC_ORIGIN}/v1/preferences/current"),
        token,
        snapshot,
        revision,
    )
    .await
}

async fn put_remote_preferences_with(
    client: &Client,
    url: String,
    token: &str,
    snapshot: &PreferenceSnapshot,
    revision: u64,
) -> Result<RemoteWriteResult, String> {
    let body = snapshot::encode(snapshot)?;
    let idempotency_key = random_idempotency_key()?;
    let response = client
        .put(url)
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
    let response_status = response.status();
    if response_status == reqwest::StatusCode::BAD_REQUEST {
        let bytes = bounded_body(response).await.unwrap_or_default();
        return Err(if indicates_unsupported_snapshot(response_status, &bytes) {
            "El servicio no admite el formato de sincronización v2. Los datos locales siguen guardados; actualiza el servicio antes de volver a sincronizar.".into()
        } else {
            "El servicio no pudo guardar la configuración.".into()
        });
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

fn indicates_unsupported_snapshot(status: reqwest::StatusCode, body: &[u8]) -> bool {
    if status != reqwest::StatusCode::BAD_REQUEST {
        return false;
    }
    serde_json::from_slice::<ApiError>(body)
        .is_ok_and(|response| response.error == "invalid_snapshot")
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
    use base64::Engine;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread::JoinHandle;

    #[test]
    fn elimina_el_estado_local_de_sincronizacion() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SYNC_STATE_FILE);
        fs::write(&path, b"estado").unwrap();

        assert_eq!(forget_sync_state_file(&path), Ok(()));
        assert!(!path.exists());
    }

    #[test]
    fn acepta_que_el_estado_local_de_sincronizacion_ya_no_exista() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SYNC_STATE_FILE);

        assert_eq!(forget_sync_state_file(&path), Ok(()));
    }

    #[test]
    fn informa_si_no_puede_borrar_el_estado_local_de_sincronizacion() {
        let directory = tempfile::tempdir().unwrap();

        let result = forget_sync_state_file(directory.path());

        assert_eq!(
            result,
            Err("No se pudo borrar el estado local de sincronización de la cuenta.".into())
        );
    }

    fn snapshot(theme_id: &str) -> PreferenceSnapshot {
        PreferenceSnapshot {
            schema_version: 2,
            preferences: crate::preferences::snapshot::SnapshotPreferences {
                theme_id: theme_id.into(),
                appearance: "dark".into(),
                update_mode: "manual".into(),
                language: Some("es".into()),
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
    fn lee_el_estado_local_solo_si_la_ruta_es_un_archivo_valido() {
        let directory = tempfile::tempdir().unwrap();
        let absent = directory.path().join("ausente.json");
        assert!(matches!(read_sync_state_file(&absent).unwrap(), None));

        let path = directory.path().join(SYNC_STATE_FILE);
        write_sync_state_file(&path, &state(9, snapshot("laurel"))).unwrap();
        assert_eq!(
            read_sync_state_file(&path).unwrap().unwrap().revision,
            Some(9)
        );

        fs::write(&path, b"{").unwrap();
        assert_error_contains(read_sync_state_file(&path), "no es válido");

        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(matches!(read_sync_state_file(&path).unwrap(), None));
    }

    #[test]
    fn escribe_y_reemplaza_el_estado_local_de_forma_atomica() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SYNC_STATE_FILE);
        fs::write(&path, b"estado anterior").unwrap();

        write_sync_state_file(&path, &state(9, snapshot("laurel"))).unwrap();

        let written = parse_sync_state(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written.revision, Some(9));
        assert_eq!(
            written.local_snapshot.unwrap().preferences.theme_id,
            "laurel"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rechaza_un_estado_excesivo_sin_alterar_el_archivo_anterior() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(SYNC_STATE_FILE);
        fs::write(&path, b"estado anterior").unwrap();
        let mut oversized = state(9, snapshot("laurel"));
        oversized
            .local_snapshot
            .as_mut()
            .unwrap()
            .preferences
            .theme_id = "x".repeat(MAX_SYNC_STATE_BYTES);

        let error = write_sync_state_file(&path, &oversized).unwrap_err();

        assert!(error.contains("supera el límite"));
        assert_eq!(fs::read(path).unwrap(), b"estado anterior");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn informa_fallos_al_preparar_o_reemplazar_el_archivo_de_estado() {
        let directory = tempfile::tempdir().unwrap();
        let state = state(9, snapshot("laurel"));
        let missing_parent = directory.path().join("ausente").join(SYNC_STATE_FILE);

        assert_error_contains(
            write_sync_state_file(&missing_parent, &state),
            "preparar el estado",
        );

        let target_directory = directory.path().join("destino");
        fs::create_dir(&target_directory).unwrap();
        assert_error_contains(
            write_sync_state_file(&target_directory, &state),
            "actualizar el estado",
        );
    }

    fn assert_error_contains<T>(result: Result<T, String>, expected: &str) {
        let error = match result {
            Ok(_) => panic!("se esperaba el error {expected}"),
            Err(error) => error,
        };
        assert!(error.contains(expected), "{error}");
    }

    fn mock_sync_server(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
    ) -> (String, JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 1024];
            loop {
                let count = stream.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
                let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n")
                else {
                    continue;
                };
                let header_text = String::from_utf8_lossy(&request[..header_end]);
                let content_length = header_text
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .or_else(|| line.strip_prefix("Content-Length:"))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response = format!(
                "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            stream.write_all(&body).unwrap();
            request
        });
        (format!("http://{address}/v1/preferences/current"), server)
    }

    async fn fetch_with_response(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
    ) -> (Result<RemoteSnapshot, String>, Vec<u8>) {
        let (url, server) = mock_sync_server(status, headers, body);
        let result = fetch_remote_preferences_with(&Client::new(), url, "test-session").await;
        (result, server.join().unwrap())
    }

    async fn history_with_response(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
    ) -> (Result<PreferenceHistoryPage, String>, Vec<u8>) {
        let (url, server) = mock_sync_server(status, headers, body);
        let result = read_remote_preference_history_with(
            &Client::new(),
            url.replace("/current", "/history?limit=25&before=8"),
            "test-session",
        )
        .await;
        (result, server.join().unwrap())
    }

    async fn delete_history_with_response(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
    ) -> (Result<(), String>, Vec<u8>) {
        let (url, server) = mock_sync_server(status, headers, body);
        let url = url.replace("/current", "/history/8");
        let result =
            delete_remote_preference_history_with(&Client::new(), url, "test-session").await;
        (result, server.join().unwrap())
    }

    async fn fetch_chunked_body(body: Vec<u8>) -> Result<RemoteSnapshot, String> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 1024];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
            }
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nETag: \"7\"\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            for part in body.chunks(MAX_RESPONSE_BYTES - 1) {
                write!(stream, "{:X}\r\n", part.len()).unwrap();
                stream.write_all(part).unwrap();
                stream.write_all(b"\r\n").unwrap();
            }
            stream.write_all(b"0\r\n\r\n").unwrap();
        });
        let result = fetch_remote_preferences_with(
            &Client::new(),
            format!("http://{address}/v1/preferences/current"),
            "test-session",
        )
        .await;
        server.join().unwrap();
        result
    }

    async fn put_with_response(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
        value: &PreferenceSnapshot,
        revision: u64,
    ) -> (Result<RemoteWriteResult, String>, Vec<u8>) {
        let (url, server) = mock_sync_server(status, headers, body);
        let result =
            put_remote_preferences_with(&Client::new(), url, "test-session", value, revision).await;
        (result, server.join().unwrap())
    }

    async fn restore_history_with_response(
        status: &'static str,
        headers: String,
        body: Vec<u8>,
        current_revision: u64,
    ) -> (Result<RemoteSnapshot, String>, Vec<u8>) {
        let (url, server) = mock_sync_server(status, headers, body);
        let url = url.replace(
            "/v1/preferences/current",
            "/v1/preferences/history/9/restore",
        );
        let result = restore_remote_preference_history_with(
            &Client::new(),
            url,
            "test-session",
            current_revision,
        )
        .await;
        (result, server.join().unwrap())
    }

    #[test]
    fn pending_state_crea_un_estado_o_preserva_la_linea_base_existente() {
        let empty = pending_sync_state(None);
        assert!(empty.pending);
        assert!(empty.local_snapshot.is_none());
        assert!(empty.cloud_snapshot.is_none());
        assert!(empty.revision.is_none());

        let existing = SyncState {
            local_snapshot: Some(snapshot("ocean")),
            cloud_snapshot: Some(snapshot("laurel")),
            revision: Some(7),
            pending: false,
        };
        let pending = pending_sync_state(Some(existing));
        assert!(pending.pending);
        assert_eq!(
            pending.local_snapshot.unwrap().preferences.theme_id,
            "ocean"
        );
        assert_eq!(
            pending.cloud_snapshot.unwrap().preferences.theme_id,
            "laurel"
        );
        assert_eq!(pending.revision, Some(7));
    }

    #[tokio::test]
    async fn consulta_la_configuracion_remota_y_rechaza_respuestas_inconsistentes() {
        let remote = RemoteSnapshot {
            snapshot: Some(snapshot("laurel")),
            revision: 7,
        };
        let (result, request) = fetch_with_response(
            "200 OK",
            "ETag: \"7\"\r\n".into(),
            serde_json::to_vec(&remote).unwrap(),
        )
        .await;
        assert_eq!(result.unwrap().revision, 7);
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.starts_with("get /v1/preferences/current http/1.1"));
        assert!(request.contains("authorization: bearer test-session"));

        let empty_remote = RemoteSnapshot {
            snapshot: None,
            revision: 7,
        };
        let (result, _) = fetch_with_response(
            "200 OK",
            "ETag: \"7\"\r\n".into(),
            serde_json::to_vec(&empty_remote).unwrap(),
        )
        .await;
        assert_eq!(result.unwrap().snapshot, None);

        let (result, _) = fetch_with_response("401 Unauthorized", String::new(), Vec::new()).await;
        assert_error_contains(result, "Inicia sesión de nuevo");

        let (result, _) =
            fetch_with_response("503 Service Unavailable", String::new(), Vec::new()).await;
        assert_error_contains(result, "no pudo leer");

        let (result, _) = fetch_with_response(
            "200 OK",
            String::new(),
            serde_json::to_vec(&remote).unwrap(),
        )
        .await;
        assert_error_contains(result, "revisión válida");

        let (result, _) = fetch_with_response(
            "200 OK",
            "ETag: \"8\"\r\n".into(),
            serde_json::to_vec(&remote).unwrap(),
        )
        .await;
        assert_error_contains(result, "no coincide");

        let (result, _) =
            fetch_with_response("200 OK", "ETag: \"7\"\r\n".into(), b"{".to_vec()).await;
        assert_error_contains(result, "configuración inválida");

        let mut invalid = snapshot("laurel");
        invalid.preferences.theme_id = "tema-inexistente".into();
        let invalid_remote = RemoteSnapshot {
            snapshot: Some(invalid),
            revision: 7,
        };
        let (result, _) = fetch_with_response(
            "200 OK",
            "ETag: \"7\"\r\n".into(),
            serde_json::to_vec(&invalid_remote).unwrap(),
        )
        .await;
        assert_error_contains(result, "no son válidas");

        let (result, _) = fetch_with_response(
            "200 OK",
            "ETag: \"7\"\r\n".into(),
            vec![b' '; MAX_RESPONSE_BYTES + 1],
        )
        .await;
        assert_error_contains(result, "supera el límite");
    }

    #[tokio::test]
    async fn consulta_historial_paginado_y_rechaza_respuestas_invalidas() {
        assert!(preference_history_url(None).ends_with("?limit=25"));
        assert!(preference_history_url(Some(8)).ends_with("?limit=25&before=8"));
        let page = PreferenceHistoryPage {
            entries: vec![PreferenceHistorySummary {
                revision: 7,
                created_at: "2026-11-25T12:00:00Z".into(),
            }],
            next_before: Some(7),
        };
        let (result, request) =
            history_with_response("200 OK", String::new(), serde_json::to_vec(&page).unwrap())
                .await;
        let result = result.unwrap();
        assert_eq!(result.entries[0].revision, 7);
        assert_eq!(result.next_before, Some(7));
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.starts_with("get /v1/preferences/history?limit=25&before=8 http/1.1"));
        assert!(request.contains("authorization: bearer test-session"));

        let (result, _) =
            history_with_response("401 Unauthorized", String::new(), Vec::new()).await;
        assert_error_contains(result, "Inicia sesión de nuevo");
        let (result, _) =
            history_with_response("503 Service Unavailable", String::new(), Vec::new()).await;
        assert_error_contains(result, "no pudo leer el historial");
        let (result, _) = history_with_response("200 OK", String::new(), b"{".to_vec()).await;
        assert_error_contains(result, "historial inválido");
        let (result, _) =
            history_with_response("200 OK", String::new(), vec![b' '; MAX_RESPONSE_BYTES + 1])
                .await;
        assert_error_contains(result, "supera el límite");
    }

    #[tokio::test]
    async fn elimina_versiones_de_historial_con_respuestas_controladas() {
        let (result, request) =
            delete_history_with_response("204 No Content", String::new(), Vec::new()).await;
        assert!(result.is_ok());
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.starts_with("delete /v1/preferences/history/8 http/1.1"));
        assert!(request.contains("authorization: bearer test-session"));

        let (result, _) =
            delete_history_with_response("401 Unauthorized", String::new(), Vec::new()).await;
        assert_error_contains(result, "Inicia sesión de nuevo");
        let (result, _) =
            delete_history_with_response("404 Not Found", String::new(), Vec::new()).await;
        assert_error_contains(result, "ya no está disponible");
        let (result, _) =
            delete_history_with_response("503 Service Unavailable", String::new(), Vec::new())
                .await;
        assert_error_contains(result, "no pudo eliminar");
    }

    #[tokio::test]
    async fn restaura_historial_con_revision_condicional_y_valida_la_respuesta() {
        let restored = RemoteSnapshot {
            snapshot: Some(snapshot("laurel")),
            revision: 10,
        };
        let (result, request) = restore_history_with_response(
            "200 OK",
            "ETag: \"10\"\r\n".into(),
            serde_json::to_vec(&restored).unwrap(),
            8,
        )
        .await;
        assert_eq!(result.unwrap().revision, 10);
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.starts_with("post /v1/preferences/history/9/restore http/1.1"));
        assert!(request.contains("authorization: bearer test-session"));
        assert!(request.contains("if-match: \"8\""));
        assert!(request.contains("idempotency-key:"));

        for (status, expected) in [
            (
                "412 Precondition Failed",
                "La nube cambió desde que cargaste el historial",
            ),
            ("401 Unauthorized", "Inicia sesión de nuevo"),
            ("503 Service Unavailable", "no pudo restaurar"),
        ] {
            let (result, _) =
                restore_history_with_response(status, String::new(), Vec::new(), 8).await;
            assert_error_contains(result, expected);
        }

        let (result, _) = restore_history_with_response(
            "200 OK",
            "ETag: \"11\"\r\n".into(),
            serde_json::to_vec(&restored).unwrap(),
            8,
        )
        .await;
        assert_error_contains(result, "revisión restaurada no coincide");

        let empty = RemoteSnapshot {
            snapshot: None,
            revision: 10,
        };
        let (result, _) = restore_history_with_response(
            "200 OK",
            "ETag: \"10\"\r\n".into(),
            serde_json::to_vec(&empty).unwrap(),
            8,
        )
        .await;
        assert_error_contains(result, "versión restaurada está vacía");

        let (result, _) =
            restore_history_with_response("200 OK", "ETag: \"10\"\r\n".into(), b"{".to_vec(), 8)
                .await;
        assert_error_contains(result, "configuración inválida");
    }

    #[tokio::test]
    async fn limita_el_cuerpo_chunked_aunque_no_anuncie_content_length() {
        let result = fetch_chunked_body(vec![b'x'; MAX_RESPONSE_BYTES + 1]).await;
        assert_error_contains(result, "supera el límite");
    }

    #[tokio::test]
    async fn rechaza_un_cuerpo_http_truncado_sin_intentar_parsearlo() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 1024];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
            }
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nETag: \"1\"\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{}",
                )
                .unwrap();
        });

        let result = fetch_remote_preferences_with(
            &Client::new(),
            format!("http://{address}/v1/preferences/current"),
            "test-session",
        )
        .await;
        server.join().unwrap();

        assert_error_contains(result, "No se pudo leer la respuesta de sincronización");
    }

    #[tokio::test]
    async fn escribe_preferencias_con_revision_idempotencia_y_conflictos_controlados() {
        let value = snapshot("laurel");
        let saved = RemoteSnapshot {
            snapshot: Some(value.clone()),
            revision: 8,
        };
        let (result, request) = put_with_response(
            "200 OK",
            "ETag: \"8\"\r\n".into(),
            serde_json::to_vec(&saved).unwrap(),
            &value,
            7,
        )
        .await;
        assert!(matches!(
            result.unwrap(),
            RemoteWriteResult::Saved { revision: 8 }
        ));
        let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
        assert!(request.starts_with("put /v1/preferences/current http/1.1"));
        assert!(request.contains("authorization: bearer test-session"));
        assert!(request.contains("if-match: \"7\""));
        assert!(request.contains("idempotency-key:"));
        assert!(request.contains("content-type: application/json"));
        assert!(request.contains("\"themeid\":\"laurel\""));

        let (result, _) = put_with_response(
            "412 Precondition Failed",
            String::new(),
            Vec::new(),
            &value,
            7,
        )
        .await;
        assert!(matches!(result.unwrap(), RemoteWriteResult::Conflict));

        for (status, expected) in [
            ("401 Unauthorized", "Inicia sesión de nuevo"),
            ("409 Conflict", "clave de idempotencia"),
            ("503 Service Unavailable", "no pudo guardar"),
        ] {
            let (result, _) = put_with_response(status, String::new(), Vec::new(), &value, 7).await;
            assert_error_contains(result, expected);
        }

        let (result, _) = put_with_response(
            "400 Bad Request",
            String::new(),
            br#"{"error":"invalid_snapshot"}"#.to_vec(),
            &value,
            7,
        )
        .await;
        assert_error_contains(result, "no admite el formato");

        let (result, _) = put_with_response(
            "400 Bad Request",
            String::new(),
            br#"{"error":"invalid_idempotency_key"}"#.to_vec(),
            &value,
            7,
        )
        .await;
        assert_error_contains(result, "no pudo guardar");

        let (result, _) = put_with_response(
            "200 OK",
            String::new(),
            serde_json::to_vec(&saved).unwrap(),
            &value,
            7,
        )
        .await;
        assert_error_contains(result, "revisión válida");

        let (result, _) = put_with_response(
            "200 OK",
            "ETag: \"9\"\r\n".into(),
            serde_json::to_vec(&saved).unwrap(),
            &value,
            7,
        )
        .await;
        assert_error_contains(result, "no coincide");

        let mismatched = RemoteSnapshot {
            snapshot: Some(snapshot("ocean")),
            revision: 8,
        };
        let (result, _) = put_with_response(
            "200 OK",
            "ETag: \"8\"\r\n".into(),
            serde_json::to_vec(&mismatched).unwrap(),
            &value,
            7,
        )
        .await;
        assert_error_contains(result, "no coincide");

        let (result, _) =
            put_with_response("200 OK", "ETag: \"8\"\r\n".into(), b"{".to_vec(), &value, 7).await;
        assert_error_contains(result, "confirmación inválida");
    }

    #[test]
    fn solo_persiste_la_linea_base_si_la_nube_confirma_la_escritura() {
        let value = snapshot("ocean");
        let mut persisted = None;
        let saved = finalize_remote_write(
            RemoteWriteResult::Saved { revision: 12 },
            &value,
            |written_snapshot, revision| {
                persisted = Some((written_snapshot.preferences.theme_id.clone(), revision));
                Ok(())
            },
        )
        .unwrap();

        assert!(matches!(saved, RemoteWriteResult::Saved { revision: 12 }));
        assert_eq!(persisted, Some(("ocean".into(), 12)));

        let conflict = finalize_remote_write(RemoteWriteResult::Conflict, &value, |_, _| {
            panic!("un conflicto no debe persistir una línea base")
        })
        .unwrap();
        assert!(matches!(conflict, RemoteWriteResult::Conflict));

        let failed =
            finalize_remote_write(RemoteWriteResult::Saved { revision: 13 }, &value, |_, _| {
                Err("No se pudo escribir el estado local.".into())
            });
        assert_error_contains(failed, "estado local");
    }

    #[test]
    fn completa_la_subida_remota_segun_guardado_conflicto_o_error() {
        let local = snapshot("ocean");
        let cloud = snapshot("laurel");
        let mut persisted = None;
        let synced = complete_sync_upload(
            Ok(RemoteWriteResult::Saved { revision: 14 }),
            local,
            cloud,
            |local, cloud, revision| {
                persisted = Some((
                    local.preferences.theme_id,
                    cloud.preferences.theme_id,
                    revision,
                ));
                Ok(())
            },
            || panic!("un guardado remoto no debe marcarse como pendiente"),
        )
        .unwrap();
        assert!(matches!(synced, SyncRunResult::Synced { revision: 14 }));
        assert_eq!(persisted, Some(("ocean".into(), "laurel".into(), 14)));

        let mut conflict_marked_pending = false;
        let conflict = complete_sync_upload(
            Ok(RemoteWriteResult::Conflict),
            snapshot("ocean"),
            snapshot("laurel"),
            |_, _, _| panic!("un conflicto no debe reemplazar la línea base"),
            || {
                conflict_marked_pending = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(matches!(conflict, SyncRunResult::Conflict));
        assert!(conflict_marked_pending);

        let mut failed_write_marked_pending = false;
        let pending = complete_sync_upload(
            Err("transporte no disponible".into()),
            snapshot("ocean"),
            snapshot("laurel"),
            |_, _, _| panic!("un fallo remoto no debe persistir una línea base"),
            || {
                failed_write_marked_pending = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(matches!(pending, SyncRunResult::Pending));
        assert!(failed_write_marked_pending);

        let persistence_error = complete_sync_upload(
            Ok(RemoteWriteResult::Saved { revision: 15 }),
            snapshot("ocean"),
            snapshot("laurel"),
            |_, _, _| Err("fallo de persistencia".into()),
            || Ok(()),
        );
        assert_error_contains(persistence_error, "persistencia");

        let pending_error = complete_sync_upload(
            Err("transporte no disponible".into()),
            snapshot("ocean"),
            snapshot("laurel"),
            |_, _, _| Ok(()),
            || Err("fallo al marcar pendiente".into()),
        );
        assert_error_contains(pending_error, "marcar pendiente");
    }

    #[test]
    fn identifica_solo_el_rechazo_v1_de_snapshot_v2() {
        let unsupported = br#"{"error":"invalid_snapshot"}"#;
        assert!(indicates_unsupported_snapshot(
            reqwest::StatusCode::BAD_REQUEST,
            unsupported
        ));
        assert!(!indicates_unsupported_snapshot(
            reqwest::StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_idempotency_key"}"#
        ));
        assert!(!indicates_unsupported_snapshot(
            reqwest::StatusCode::BAD_REQUEST,
            br#"{"error":"invalid_snapshot","detail":"unexpected"}"#
        ));
        assert!(!indicates_unsupported_snapshot(
            reqwest::StatusCode::BAD_REQUEST,
            b"not-json"
        ));
        assert!(!indicates_unsupported_snapshot(
            reqwest::StatusCode::UNPROCESSABLE_ENTITY,
            unsupported
        ));
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
    fn exige_eleccion_si_falta_cualquier_parte_de_la_linea_base_local() {
        let local = snapshot("laurel");
        let remote = RemoteSnapshot {
            snapshot: Some(snapshot("ocean")),
            revision: 5,
        };
        let mut incomplete_states = Vec::new();

        let mut missing_revision = state(5, local.clone());
        missing_revision.revision = None;
        incomplete_states.push(missing_revision);

        let mut missing_local_snapshot = state(5, local.clone());
        missing_local_snapshot.local_snapshot = None;
        incomplete_states.push(missing_local_snapshot);

        let mut missing_cloud_snapshot = state(5, local);
        missing_cloud_snapshot.cloud_snapshot = None;
        incomplete_states.push(missing_cloud_snapshot);

        for incomplete in incomplete_states {
            assert_eq!(
                decide_sync(Some(&incomplete), &remote, &snapshot("laurel")),
                SyncDecision::NeedsChoice
            );
        }
    }

    #[test]
    fn detecta_un_cambio_remoto_aunque_la_revision_no_haya_cambiado() {
        let baseline = snapshot("laurel");
        let remote = RemoteSnapshot {
            snapshot: None,
            revision: 8,
        };

        assert_eq!(
            decide_sync(
                Some(&state(8, baseline.clone())),
                &remote,
                &snapshot("ocean")
            ),
            SyncDecision::Conflict
        );

        let changed_remote = RemoteSnapshot {
            snapshot: Some(snapshot("ocean")),
            revision: 8,
        };
        assert_eq!(
            decide_sync(
                Some(&state(8, baseline)),
                &changed_remote,
                &snapshot("laurel")
            ),
            SyncDecision::Conflict
        );
    }

    #[test]
    fn verifica_la_revision_y_el_contenido_antes_de_aplicar_un_snapshot_remoto() {
        let expected = snapshot("laurel");
        let matching_remote = RemoteSnapshot {
            snapshot: Some(expected.clone()),
            revision: 8,
        };
        assert_eq!(
            validate_remote_snapshot(&matching_remote, &expected, 8),
            Ok(())
        );

        for (remote, revision) in [
            (matching_remote, 9),
            (
                RemoteSnapshot {
                    snapshot: None,
                    revision: 8,
                },
                8,
            ),
            (
                RemoteSnapshot {
                    snapshot: Some(snapshot("ocean")),
                    revision: 8,
                },
                8,
            ),
        ] {
            assert_error_contains(
                validate_remote_snapshot(&remote, &expected, revision),
                "La nube cambió",
            );
        }
    }

    #[test]
    fn solo_confirma_la_nube_si_revision_y_preferencias_coinciden() {
        let expected = snapshot("laurel");
        let mut persisted = None;
        let confirmed = finalize_remote_confirmation(
            RemoteSnapshot {
                snapshot: Some(expected.clone()),
                revision: 8,
            },
            expected.clone(),
            8,
            |local, cloud, revision| {
                persisted = Some((
                    local.preferences.theme_id,
                    cloud.preferences.theme_id,
                    revision,
                ));
                Ok(())
            },
        )
        .unwrap();
        assert!(confirmed);
        assert_eq!(persisted, Some(("laurel".into(), "laurel".into(), 8)));

        for (remote, revision) in [
            (
                RemoteSnapshot {
                    snapshot: Some(expected.clone()),
                    revision: 7,
                },
                8,
            ),
            (
                RemoteSnapshot {
                    snapshot: None,
                    revision: 8,
                },
                8,
            ),
            (
                RemoteSnapshot {
                    snapshot: Some(snapshot("ocean")),
                    revision: 8,
                },
                8,
            ),
        ] {
            assert_eq!(
                finalize_remote_confirmation(remote, expected.clone(), revision, |_, _, _| {
                    panic!("no debe persistir una confirmación remota inválida")
                }),
                Ok(false)
            );
        }

        let failed_persistence = finalize_remote_confirmation(
            RemoteSnapshot {
                snapshot: Some(expected.clone()),
                revision: 8,
            },
            expected,
            8,
            |_, _, _| Err("No se pudo guardar la línea base.".into()),
        );
        assert_error_contains(failed_persistence, "línea base");
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
    fn v1_en_la_nube_y_v2_en_local_con_los_mismos_ajustes_no_piden_eleccion() {
        let mut cloud = snapshot("laurel");
        cloud.schema_version = 1;
        cloud.preferences.language = None;
        let local = snapshot("laurel");
        let remote = RemoteSnapshot {
            snapshot: Some(cloud),
            revision: 5,
        };
        assert_eq!(
            decide_sync(None, &remote, &local),
            SyncDecision::AlreadyEqual
        );

        let mut other_language = local.clone();
        other_language.preferences.language = Some("en".into());
        assert_eq!(
            decide_sync(None, &remote, &other_language),
            SyncDecision::AlreadyEqual
        );

        let different = snapshot("ocean");
        assert_eq!(
            decide_sync(None, &remote, &different),
            SyncDecision::NeedsChoice
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
    fn conserva_endpoint_local_y_no_inventa_uno_ausente_en_cloud() {
        let provider = |id: &str, endpoint| crate::preferences::snapshot::SnapshotProvider {
            id: id.into(),
            kind: "custom".into(),
            name: "Servidor".into(),
            model: "modelo".into(),
            custom_endpoint: endpoint,
        };
        let local_endpoint = "https://local.example/v1";
        let mut local = snapshot("ocean");
        local
            .providers
            .push(provider("perfil-local", Some(local_endpoint.to_string())));
        local.providers.push(provider("perfil-sin-cloud", None));

        let mut cloud = snapshot("laurel");
        cloud.providers.push(provider(
            "perfil-local",
            Some("https://cloud.example/v1".into()),
        ));
        cloud.providers.push(provider("perfil-sin-cloud", None));

        let outgoing = preserve_unshared_endpoints(&local, &Some(cloud), None).unwrap();
        assert_eq!(
            outgoing.providers[0].custom_endpoint.as_deref(),
            Some(local_endpoint)
        );
        assert_eq!(outgoing.providers[1].custom_endpoint, None);

        let without_cloud = preserve_unshared_endpoints(&local, &None, None).unwrap();
        assert_eq!(without_cloud, local);
    }

    #[test]
    fn valida_etag_y_acepta_revision_cero_o_positiva() {
        assert_eq!(parse_etag_revision("\"0\""), Some(0));
        assert_eq!(parse_etag_revision("\"42\""), Some(42));
        assert_eq!(
            parse_etag_revision(&format!("\"{}\"", u64::MAX)),
            Some(u64::MAX)
        );
        for value in ["0", "\"\"", "\"01\"", "\"-1\"", "\"1\"x", "\"x\""] {
            assert_eq!(parse_etag_revision(value), None, "{value}");
        }
        assert_eq!(parse_etag_revision("\"18446744073709551616\""), None);
    }

    #[test]
    fn genera_claves_de_idempotencia_compatibles_con_el_api() {
        let key = random_idempotency_key().unwrap();
        assert!((16..=128).contains(&key.len()));
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(key)
            .unwrap();
        assert_eq!(decoded.len(), 32);
    }

    #[test]
    fn valida_estado_local_serializado_y_rechaza_datos_danados_o_incompletos() {
        let valid = state(3, snapshot("laurel"));
        let bytes = serde_json::to_vec(&valid).unwrap();
        assert_eq!(parse_sync_state(&bytes).unwrap().revision, Some(3));

        assert_eq!(
            parse_sync_state(b"{").err().unwrap(),
            "El estado local de sincronización no es válido."
        );
        assert_eq!(
            parse_sync_state(b"{\"pending\":true}").err().unwrap(),
            "El estado local de sincronización no es válido."
        );

        let incomplete = SyncState {
            local_snapshot: Some(snapshot("laurel")),
            cloud_snapshot: None,
            revision: Some(3),
            pending: true,
        };
        let bytes = serde_json::to_vec(&incomplete).unwrap();
        assert_eq!(
            parse_sync_state(&bytes).err().unwrap(),
            "El estado local de sincronización está incompleto."
        );

        let mut invalid_snapshot = state(3, snapshot("laurel"));
        invalid_snapshot
            .local_snapshot
            .as_mut()
            .unwrap()
            .preferences
            .theme_id = "desconocido".into();
        let bytes = serde_json::to_vec(&invalid_snapshot).unwrap();
        assert!(parse_sync_state(&bytes).is_err());
    }

    #[test]
    fn rechaza_estado_con_revision_incoherente_o_campos_desconocidos() {
        let mut without_revision = state(3, snapshot("laurel"));
        without_revision.revision = None;
        assert!(validate_sync_state(without_revision).is_err());

        let without_snapshots = SyncState {
            local_snapshot: None,
            cloud_snapshot: None,
            revision: Some(3),
            pending: true,
        };
        assert!(validate_sync_state(without_snapshots).is_err());

        let with_unknown_field = serde_json::json!({
            "localSnapshot": null,
            "cloudSnapshot": null,
            "revision": null,
            "pending": true,
            "apiKey": "no-debe-persistirse"
        });
        assert!(parse_sync_state(&serde_json::to_vec(&with_unknown_field).unwrap()).is_err());
    }

    #[test]
    fn rechaza_estado_local_mayor_que_el_limite_antes_de_parsearlo() {
        let bytes = vec![b' '; MAX_SYNC_STATE_BYTES + 1];
        assert_eq!(
            parse_sync_state(&bytes).err().unwrap(),
            "El estado local de sincronización supera el límite permitido."
        );
    }
}
