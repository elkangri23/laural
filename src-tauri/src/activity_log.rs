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
    let contents = read_bounded(
        File::open(path)
            .map_err(|_| "No se pudo leer el registro local de actividad.".to_string())?,
    )?;
    serde_json::from_slice(&contents)
        .map_err(|_| "El registro local de actividad no es válido.".to_string())
}

fn read_bounded(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut contents = Vec::with_capacity(MAX_FILE_BYTES as usize);
    reader
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut contents)
        .map_err(|_| "No se pudo leer el registro local de actividad.".to_string())?;
    if contents.len() as u64 > MAX_FILE_BYTES {
        return Err("El registro local de actividad supera su límite de tamaño.".into());
    }
    Ok(contents)
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
    fn conserva_el_limite_exacto_y_elimina_solo_la_entrada_mas_antigua() {
        let mut entries = (0..MAX_ENTRIES)
            .map(|timestamp| ActivityEntry {
                timestamp_ms: timestamp as u64,
                action: ActivityAction::Command.label().to_string(),
                outcome: ActivityOutcome::Completed.label().to_string(),
            })
            .collect::<Vec<_>>();
        assert_eq!(entries.len(), MAX_ENTRIES);
        append_entry(
            &mut entries,
            ActivityEntry {
                timestamp_ms: MAX_ENTRIES as u64,
                action: ActivityAction::FileRestore.label().to_string(),
                outcome: ActivityOutcome::Failed.label().to_string(),
            },
        );

        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries[0].timestamp_ms, 1);
        assert_eq!(entries[MAX_ENTRIES - 1].timestamp_ms, MAX_ENTRIES as u64);
    }

    #[test]
    fn solo_emite_categorias_fijas_para_accion_y_resultado() {
        assert_eq!(
            [
                ActivityAction::Command.label(),
                ActivityAction::FileWrite.label(),
                ActivityAction::FileRestore.label(),
                ActivityAction::BackupCleanup.label(),
            ],
            ["comando", "archivo", "restauración", "limpieza de copias"]
        );
        assert_eq!(
            [
                ActivityOutcome::Completed.label(),
                ActivityOutcome::Submitted.label(),
                ActivityOutcome::Rejected.label(),
                ActivityOutcome::Failed.label(),
            ],
            ["completado", "enviado", "rechazado", "fallido"]
        );
    }

    #[test]
    fn lectura_ausente_devuelve_historial_vacio_y_danado_se_rechaza() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        assert!(read_entries(&path).unwrap().is_empty());
        fs::write(&path, b"json incompleto").unwrap();
        assert!(read_entries(&path).is_err());
    }

    #[test]
    fn rechaza_una_ruta_con_caracter_nulo_sin_exponer_detalles_del_sistema() {
        let path = PathBuf::from("registro\0actividad.json");

        assert!(matches!(
            read_entries(&path),
            Err(message) if message == "No se pudo leer el registro local de actividad."
        ));
    }

    #[test]
    fn rechaza_un_directorio_como_archivo_de_historial() {
        let directory = tempfile::tempdir().unwrap();

        assert!(matches!(
            read_entries(directory.path()),
            Err(message) if message == "No se pudo leer el registro local de actividad."
        ));
    }

    #[test]
    fn rechaza_un_registro_grande_y_conserva_el_anterior() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        let original = ActivityEntry {
            timestamp_ms: 7,
            action: ActivityAction::Command.label().to_string(),
            outcome: ActivityOutcome::Completed.label().to_string(),
        };
        write_entries(&path, std::slice::from_ref(&original)).unwrap();
        let oversized = ActivityEntry {
            timestamp_ms: 8,
            action: "a".repeat(MAX_FILE_BYTES as usize),
            outcome: ActivityOutcome::Failed.label().to_string(),
        };

        assert!(write_entries(&path, &[oversized]).is_err());
        assert_eq!(
            read_entries(&path).unwrap()[0].timestamp_ms,
            original.timestamp_ms
        );
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
    fn fallo_al_crear_temporal_no_crea_un_registro_parcial() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("directorio-inexistente")
            .join("agent-activity.json");
        let entry = ActivityEntry {
            timestamp_ms: 1,
            action: ActivityAction::Command.label().to_string(),
            outcome: ActivityOutcome::Completed.label().to_string(),
        };

        assert_eq!(
            write_entries(&path, &[entry]).unwrap_err(),
            "No se pudo guardar el registro local de actividad."
        );
        assert!(!path.exists());
    }

    #[test]
    fn fallo_al_reemplazar_directorio_conserva_el_destino() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        fs::create_dir(&path).unwrap();
        let entry = ActivityEntry {
            timestamp_ms: 1,
            action: ActivityAction::Command.label().to_string(),
            outcome: ActivityOutcome::Completed.label().to_string(),
        };

        assert_eq!(
            write_entries(&path, &[entry]).unwrap_err(),
            "No se pudo guardar el registro local de actividad."
        );
        assert!(path.is_dir());
    }

    #[test]
    fn rechaza_registros_mayores_al_limite() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("agent-activity.json");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        assert!(read_entries(&path).is_err());
    }

    #[test]
    fn limita_la_lectura_si_el_archivo_crece_despues_de_comprobar_su_tamano() {
        let at_limit = vec![b'x'; MAX_FILE_BYTES as usize];
        assert_eq!(
            read_bounded(at_limit.as_slice()).unwrap().len(),
            at_limit.len()
        );

        let above_limit = vec![b'x'; MAX_FILE_BYTES as usize + 1];
        assert_eq!(
            read_bounded(above_limit.as_slice()).unwrap_err(),
            "El registro local de actividad supera su límite de tamaño."
        );
    }

    #[test]
    fn oculta_detalles_del_sistema_si_falla_la_lectura_del_registro() {
        struct FailingReader;

        impl Read for FailingReader {
            fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("detalle interno"))
            }
        }

        assert_eq!(
            read_bounded(FailingReader).unwrap_err(),
            "No se pudo leer el registro local de actividad."
        );
    }
}
