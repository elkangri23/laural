use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

const MAX_ENTRIES: usize = 200;
const MAX_FILE_BYTES: u64 = 64 * 1024;
const VISIBLE_ENTRIES: usize = 30;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy)]
pub(crate) enum ActivityAction {
    Command,
    FileWrite,
    FileRestore,
    BackupCleanup,
}

impl ActivityAction {
    fn label(self) -> &'static str {
        match self {
            Self::Command => "comando",
            Self::FileWrite => "archivo",
            Self::FileRestore => "restauración",
            Self::BackupCleanup => "limpieza de copias",
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum ActivityOutcome {
    Completed,
    Submitted,
    Rejected,
    Failed,
}

impl ActivityOutcome {
    fn label(self) -> &'static str {
        match self {
            Self::Completed => "completado",
            Self::Submitted => "enviado",
            Self::Rejected => "rechazado",
            Self::Failed => "fallido",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    timestamp_ms: u64,
    action: String,
    outcome: String,
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "No se pudo localizar el registro local de actividad.".to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|_| "No se pudo preparar el registro local de actividad.".to_string())?;
    Ok(directory.join("agent-activity.json"))
}

fn read_entries(path: &Path) -> Result<Vec<ActivityEntry>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("No se pudo leer el registro local de actividad.".into()),
    };
    if metadata.len() > MAX_FILE_BYTES {
        return Err("El registro local de actividad supera su límite de tamaño.".into());
    }
    let mut contents = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_end(&mut contents))
        .map_err(|_| "No se pudo leer el registro local de actividad.".to_string())?;
    if contents.len() as u64 > MAX_FILE_BYTES {
        return Err("El registro local de actividad supera su límite de tamaño.".into());
    }
    serde_json::from_slice(&contents)
        .map_err(|_| "El registro local de actividad no es válido.".to_string())
}

fn write_entries(path: &Path, entries: &[ActivityEntry]) -> Result<(), String> {
    let bytes = serde_json::to_vec(entries)
        .map_err(|_| "No se pudo preparar el registro local de actividad.".to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("El registro local de actividad supera su límite de tamaño.".into());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "No se pudo localizar el registro local de actividad.".to_string())?;
    let mut temporary = NamedTempFile::new_in(directory)
        .map_err(|_| "No se pudo guardar el registro local de actividad.".to_string())?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "No se pudo guardar el registro local de actividad.".to_string())?;
    temporary
        .persist(path)
        .map(|_| ())
        .map_err(|_| "No se pudo guardar el registro local de actividad.".to_string())
}

pub(crate) fn record(app: &AppHandle, action: ActivityAction, outcome: ActivityOutcome) {
    let Ok(path) = log_path(app) else { return };
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    let Ok(mut entries) = read_entries(&path) else {
        return;
    };
    append_entry(
        &mut entries,
        ActivityEntry {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u64::MAX as u128) as u64,
            action: action.label().to_string(),
            outcome: outcome.label().to_string(),
        },
    );
    let _ = write_entries(&path, &entries);
}

fn append_entry(entries: &mut Vec<ActivityEntry>, entry: ActivityEntry) {
    entries.push(entry);
    if entries.len() > MAX_ENTRIES {
        entries.drain(..entries.len() - MAX_ENTRIES);
    }
}

#[tauri::command]
pub fn get_agent_activity(app: AppHandle) -> Result<Vec<ActivityEntry>, String> {
    let path = log_path(&app)?;
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "No se pudo consultar el registro local de actividad.".to_string())?;
    let entries = read_entries(&path)?;
    Ok(entries.into_iter().rev().take(VISIBLE_ENTRIES).collect())
}

#[tauri::command]
pub fn clear_agent_activity(app: AppHandle) -> Result<(), String> {
    let path = log_path(&app)?;
    let _guard = WRITE_LOCK
        .lock()
        .map_err(|_| "No se pudo borrar el registro local de actividad.".to_string())?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("No se pudo borrar el registro local de actividad.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mantiene_un_historial_acotado_sin_campos_de_contenido() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        let mut entries = Vec::new();
        for index in 0..MAX_ENTRIES + 5 {
            append_entry(
                &mut entries,
                ActivityEntry {
                    timestamp_ms: index as u64,
                    action: ActivityAction::Command.label().to_string(),
                    outcome: ActivityOutcome::Completed.label().to_string(),
                },
            );
        }
        write_entries(&path, &entries).unwrap();

        let stored = read_entries(&path).unwrap();
        assert_eq!(stored.len(), MAX_ENTRIES);
        assert_eq!(stored[0].timestamp_ms, 5);
        assert_eq!(stored.last().unwrap().timestamp_ms, 204);
        let json = fs::read_to_string(path).unwrap();
        assert!(!json.contains("command"));
        assert!(!json.contains("path"));
        assert!(!json.contains("content"));
    }

    #[test]
    fn reemplaza_el_historial_atomico_varias_veces() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        let first = ActivityEntry {
            timestamp_ms: 1,
            action: ActivityAction::Command.label().to_string(),
            outcome: ActivityOutcome::Completed.label().to_string(),
        };
        let second = ActivityEntry {
            timestamp_ms: 2,
            action: ActivityAction::FileWrite.label().to_string(),
            outcome: ActivityOutcome::Rejected.label().to_string(),
        };
        write_entries(&path, &[first]).unwrap();
        write_entries(&path, &[second]).unwrap();
        assert_eq!(read_entries(&path).unwrap()[0].timestamp_ms, 2);
    }

    #[test]
    fn rechaza_registros_mayores_al_limite() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(read_entries(&path).is_err());
    }
}
