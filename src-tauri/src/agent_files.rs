use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;

const BACKUPS: &str = ".laural-backups";
static EDIT: Mutex<()> = Mutex::new(());

fn invalid(reason: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, reason)
}

fn valid_name(name: &str) -> bool {
    let base = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let device = matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        base.strip_prefix(prefix).is_some_and(|n| {
            matches!(
                n,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    });
    !device
        && !name.ends_with(['.', ' '])
        && !name.eq_ignore_ascii_case(BACKUPS)
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
}

#[cfg(windows)]
fn pin_directory(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::*;
    // Keep the directory open without delete sharing until the edit is committed.
    let handle = File::options()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let meta = handle.metadata()?;
    if !meta.is_dir() || meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(invalid("La carpeta no es un directorio ordinario."));
    }
    Ok(handle)
}

#[cfg(not(windows))]
fn pin_directory(path: &Path) -> io::Result<File> {
    if !fs::symlink_metadata(path)?.file_type().is_dir() {
        return Err(invalid("La carpeta no es un directorio ordinario."));
    }
    File::open(path)
}

fn descend(parent: &Path, name: &std::ffi::OsStr, pins: &mut Vec<File>) -> io::Result<PathBuf> {
    let next = parent.join(name);
    match fs::create_dir(&next) {
        Err(e) if e.kind() != io::ErrorKind::AlreadyExists => return Err(e),
        _ => {}
    }
    pins.push(pin_directory(&next)?);
    Ok(next)
}

#[cfg(windows)]
fn replace(target: &Path, staged: &Path, backup: &Path) -> io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let wide = |p: &Path| {
        p.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    let (target, staged, backup) = (wide(target), wide(staged), wide(backup));
    // The three terminated UTF-16 buffers live until the synchronous operation returns.
    if unsafe {
        ReplaceFileW(
            target.as_ptr(),
            staged.as_ptr(),
            backup.as_ptr(),
            0,
            ptr::null(),
            ptr::null(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace(target: &Path, staged: &Path, backup: &Path) -> io::Result<()> {
    fs::copy(target, backup)?;
    fs::rename(staged, target)
}

#[cfg(test)]
pub(crate) fn save(
    root: &Path,
    relative: &str,
    content: &[u8],
    approved: bool,
) -> Result<String, String> {
    save_with_retention(root, relative, content, approved, None)
}

pub(crate) fn save_with_retention(
    root: &Path,
    relative: &str,
    content: &[u8],
    approved: bool,
    keep_backups: Option<usize>,
) -> Result<String, String> {
    if !approved {
        return Err("Los cambios de archivos requieren aprobación explícita.".into());
    }
    if keep_backups.is_some_and(|limit| !(1..=100).contains(&limit)) {
        return Err("El límite de copias debe estar entre 1 y 100.".into());
    }
    if content.len() > 100_000 {
        return Err("El archivo supera el límite de 100 KB.".into());
    }
    let relative = Path::new(relative);
    if relative.file_name().is_none()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(s) if s.to_str().is_some_and(valid_name)))
    {
        return Err("La ruta debe ser relativa y usar nombres de archivo válidos.".into());
    }
    let _edit = EDIT.lock().map_err(|_| "No se pudo iniciar la edición.")?;
    let message = write_file(root, relative, content)
        .map_err(|e| format!("No se pudo guardar {}: {e}", relative.display()))?;
    if let Some(limit) = keep_backups {
        return match prune_backups(root, relative, limit) {
            Ok(removed) if removed > 0 => {
                Ok(format!("{message}. Copias antiguas eliminadas: {removed}."))
            }
            Ok(_) => Ok(message),
            Err(_) => Ok(format!(
                "{message}. No se pudieron eliminar todas las copias antiguas."
            )),
        };
    }
    Ok(message)
}

fn write_file(root: &Path, relative: &Path, content: &[u8]) -> io::Result<String> {
    let root = root.canonicalize()?;
    let mut pins = vec![pin_directory(&root)?];
    let reserved = root.join(BACKUPS).canonicalize().ok();
    let mut parent = root.clone();
    for name in relative.parent().unwrap_or(Path::new("")).iter() {
        parent = descend(&parent, name, &mut pins)?;
        if reserved.as_ref() == Some(&parent.canonicalize()?) {
            return Err(invalid("La carpeta de copias está reservada."));
        }
    }
    let name = relative
        .file_name()
        .ok_or_else(|| invalid("Falta el nombre del archivo."))?;
    let target = parent.join(name);
    let existing = match fs::symlink_metadata(&target) {
        Ok(m) if m.file_type().is_file() => {
            #[cfg(windows)]
            if std::os::windows::fs::MetadataExt::file_attributes(&m)
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                != 0
            {
                return Err(invalid("El destino debe ser un archivo ordinario."));
            }
            true
        }
        Ok(_) => return Err(invalid("El destino debe ser un archivo ordinario.")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => false,
        Err(e) => return Err(e),
    };
    let mut staged = NamedTempFile::new_in(&parent)?;
    staged.write_all(content)?;
    staged.as_file().sync_all()?;
    if !existing {
        staged.persist_noclobber(target)?;
        return Ok(format!("Archivo creado: {}", relative.display()));
    }
    let backups = descend(&root, BACKUPS.as_ref(), &mut pins)?;
    let version = tempfile::Builder::new()
        .prefix("edicion-")
        .tempdir_in(backups)?;
    let mut backup_pins = vec![pin_directory(version.path())?];
    let mut backup_dir = version.path().to_owned();
    for part in relative.parent().unwrap_or(Path::new("")).iter() {
        backup_dir = descend(&backup_dir, part, &mut backup_pins)?;
    }
    let backup = backup_dir.join(name);
    let staged = staged.into_temp_path();
    // Keep a backup left by the OS even if replacement reports a partial failure.
    let result = replace(&target, &staged, &backup);
    if result.is_ok() || backup.exists() {
        let _ = version.keep();
    }
    drop(backup_pins);
    result?;
    Ok(format!(
        "Archivo guardado. Copia: {}",
        backup.strip_prefix(&root).unwrap_or(&backup).display()
    ))
}

pub(crate) fn list_backups(root: &Path, relative: &str) -> Result<Vec<String>, String> {
    let relative = Path::new(relative);
    if relative.file_name().is_none()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(s) if s.to_str().is_some_and(valid_name)))
    {
        return Err("La ruta del archivo no es válida.".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "No se encontró el proyecto.")?;
    let _root_pin = pin_directory(&root).map_err(|_| "No se pudo comprobar el proyecto.")?;
    let mut entries =
        backup_entries(&root, relative).map_err(|_| "No se pudieron listar las copias.")?;
    entries.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    Ok(entries.into_iter().take(20).map(|entry| entry.1).collect())
}

fn backup_entries(root: &Path, relative: &Path) -> io::Result<Vec<(SystemTime, String, PathBuf)>> {
    let backups = root.join(BACKUPS);
    if !backups.exists() {
        return Ok(Vec::new());
    }
    let _backup_pin = pin_directory(&backups)?;
    let backups = backups.canonicalize()?;
    let mut result = Vec::new();
    for entry in fs::read_dir(&backups)? {
        let entry = entry?;
        let version = entry.file_name().to_string_lossy().into_owned();
        if !version.starts_with("edicion-")
            || !version
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            continue;
        }
        let version_root = entry.path();
        let Ok(_version_pin) = pin_directory(&version_root) else {
            continue;
        };
        let Ok(canonical_version) = version_root.canonicalize() else {
            continue;
        };
        if !canonical_version.starts_with(&backups) {
            continue;
        }
        let candidate = version_root.join(relative);
        let safe_parent = candidate.parent().is_some_and(|parent| {
            parent
                .canonicalize()
                .is_ok_and(|canonical| canonical.starts_with(&canonical_version))
        });
        let Ok(metadata) = fs::symlink_metadata(&candidate) else {
            continue;
        };
        if !safe_parent || !metadata.file_type().is_file() || metadata.len() > 100_000 {
            continue;
        }
        let version_time = fs::metadata(&version_root)
            .and_then(|metadata| metadata.created().or_else(|_| metadata.modified()))
            .unwrap_or(UNIX_EPOCH);
        result.push((version_time, version, version_root));
    }
    Ok(result)
}

fn prune_backups(root: &Path, relative: &Path, keep: usize) -> io::Result<usize> {
    let root = root.canonicalize()?;
    let entries = backup_entries(&root, relative)?;
    let mut entries = entries;
    entries.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    let mut removed = 0;
    for (_, _, version_root) in entries.into_iter().skip(keep) {
        if remove_backup_file(&root, &version_root, relative)? {
            removed += 1;
        }
    }
    Ok(removed)
}

fn remove_backup_file(root: &Path, version_root: &Path, relative: &Path) -> io::Result<bool> {
    let backups = root.join(BACKUPS).canonicalize()?;
    let version_root = version_root.canonicalize()?;
    if !version_root.starts_with(backups) {
        return Ok(false);
    }
    let version_pin = match pin_directory(&version_root) {
        Ok(pin) => pin,
        Err(_) => return Ok(false),
    };
    let candidate = version_root.join(relative);
    let mut pins = Vec::new();
    let mut parent = version_root.clone();
    for part in relative.parent().unwrap_or(Path::new("")).iter() {
        parent.push(part);
        match pin_directory(&parent) {
            Ok(pin) => pins.push(pin),
            Err(_) => return Ok(false),
        }
    }
    let Some(candidate_parent) = candidate.parent() else {
        return Ok(false);
    };
    if !candidate_parent
        .canonicalize()
        .is_ok_and(|canonical| canonical.starts_with(&version_root))
    {
        return Ok(false);
    }
    let Ok(metadata) = fs::symlink_metadata(&candidate) else {
        return Ok(false);
    };
    if !metadata.file_type().is_file() {
        return Ok(false);
    }
    fs::remove_file(&candidate)?;
    drop(pins);
    drop(version_pin);

    let mut directory = candidate_parent.to_path_buf();
    while directory != version_root {
        if fs::remove_dir(&directory).is_err() {
            break;
        }
        let Some(parent) = directory.parent() else {
            break;
        };
        directory = parent.to_path_buf();
    }
    let _ = fs::remove_dir(&version_root);
    Ok(true)
}

#[cfg(test)]
pub(crate) fn restore(
    root: &Path,
    relative: &str,
    version: &str,
    approved: bool,
) -> Result<String, String> {
    restore_with_retention(root, relative, version, approved, None)
}

pub(crate) fn restore_with_retention(
    root: &Path,
    relative: &str,
    version: &str,
    approved: bool,
    keep_backups: Option<usize>,
) -> Result<String, String> {
    if !approved {
        return Err("Restaurar una copia requiere aprobación explícita.".into());
    }
    if !version.starts_with("edicion-")
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("La versión de copia no es válida.".into());
    }
    let relative = Path::new(relative);
    if relative.file_name().is_none()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(s) if s.to_str().is_some_and(valid_name)))
    {
        return Err("La ruta del archivo no es válida.".into());
    }
    let root_path = root
        .canonicalize()
        .map_err(|_| "No se encontró el proyecto.")?;
    let backup_root = root_path.join(BACKUPS);
    let _root_pin = pin_directory(&root_path).map_err(|_| "No se pudo comprobar el proyecto.")?;
    let _backup_pin =
        pin_directory(&backup_root).map_err(|_| "No se pudo comprobar el almacén de copias.")?;
    let version_path = backup_root.join(version);
    let _version_pin = pin_directory(&version_path).map_err(|_| "No se encontró esa copia.")?;
    let backup = version_path.join(relative);
    let parent = backup.parent().ok_or("La ruta de la copia no es válida.")?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "No se encontró esa copia.")?;
    if !canonical_parent.starts_with(&version_path) {
        return Err("La ruta de la copia sale de su versión.".into());
    }
    let metadata = fs::symlink_metadata(&backup).map_err(|_| "No se encontró esa copia.")?;
    if !metadata.file_type().is_file() || metadata.len() > 100_000 {
        return Err("La copia no es un archivo válido.".into());
    }
    let content = fs::read(&backup).map_err(|_| "No se pudo leer la copia.")?;
    save_with_retention(
        &root_path,
        relative.to_str().unwrap_or_default(),
        &content,
        true,
        keep_backups,
    )
}
pub(crate) fn clear_backups(root: &Path, relative: &str, approved: bool) -> Result<usize, String> {
    if !approved {
        return Err("Eliminar copias requiere confirmación explícita.".into());
    }
    let relative = Path::new(relative);
    if relative.file_name().is_none()
        || !relative
            .components()
            .all(|part| matches!(part, Component::Normal(s) if s.to_str().is_some_and(valid_name)))
    {
        return Err("La ruta del archivo no es válida.".into());
    }
    let _edit = EDIT.lock().map_err(|_| "No se pudo iniciar la limpieza.")?;
    let root = root
        .canonicalize()
        .map_err(|_| "No se encontró el proyecto.")?;
    let backups = root.join(BACKUPS);
    if !backups.exists() {
        return Ok(0);
    }
    let _root_pin = pin_directory(&root).map_err(|_| "No se pudo comprobar el proyecto.")?;
    let _backup_pin =
        pin_directory(&backups).map_err(|_| "No se pudo comprobar el almacén de copias.")?;
    let mut removed = 0;
    for entry in fs::read_dir(&backups).map_err(|_| "No se pudieron listar las copias.")? {
        let entry = entry.map_err(|_| "No se pudo leer una copia.")?;
        let version = entry.file_name().to_string_lossy().into_owned();
        if !version.starts_with("edicion-")
            || !version
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            continue;
        }
        let version_root = entry.path();
        if pin_directory(&version_root).is_err() {
            continue;
        }
        let candidate = version_root.join(relative);
        let Some(parent) = candidate.parent() else {
            continue;
        };
        if !parent
            .canonicalize()
            .is_ok_and(|canonical| canonical.starts_with(&version_root))
        {
            continue;
        }
        if fs::symlink_metadata(&candidate).is_ok_and(|meta| meta.file_type().is_file()) {
            fs::remove_file(candidate).map_err(|_| "No se pudo eliminar una copia.")?;
            removed += 1;
        }
    }
    Ok(removed)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_aprobacion_y_el_tamano_se_validan_antes_de_crear_carpetas() {
        let root = tempfile::tempdir().unwrap();
        assert!(save(root.path(), "src/prueba.txt", b"hola", false).is_err());
        assert!(save(root.path(), "src/prueba.txt", &vec![0; 100_001], true).is_err());
        for path in [
            "../fuera.txt",
            ".LAURAL-BACKUPS/copia",
            "NUL.txt",
            "file:otro",
            "carpeta./dato",
        ] {
            assert!(save(root.path(), path, b"x", true).is_err(), "{path}");
        }
        assert_eq!(root.path().read_dir().unwrap().count(), 0);
    }

    #[test]
    fn guarda_versiones_distintas_con_la_ruta_original() {
        let root = tempfile::tempdir().unwrap();
        let path = "src/config.json";
        save(root.path(), path, b"uno", true).unwrap();
        assert!(!root.path().join(BACKUPS).exists());
        save(root.path(), path, b"dos", true).unwrap();
        save(root.path(), path, b"tres", true).unwrap();
        assert_eq!(fs::read(root.path().join(path)).unwrap(), b"tres");
        let mut backups: Vec<_> = root
            .path()
            .join(BACKUPS)
            .read_dir()
            .unwrap()
            .map(|entry| fs::read(entry.unwrap().path().join(path)).unwrap())
            .collect();
        backups.sort();
        assert_eq!(backups, [b"dos", b"uno"]);
    }

    #[test]
    fn retencion_automatica_conserva_las_versiones_recientes_por_archivo() {
        let root = tempfile::tempdir().unwrap();
        let path = "src/config.json";
        save(root.path(), "otro.txt", b"otro-uno", true).unwrap();
        save(root.path(), "otro.txt", b"otro-dos", true).unwrap();
        save_with_retention(root.path(), path, b"uno", true, Some(2)).unwrap();
        for content in [&b"dos"[..], &b"tres"[..], &b"cuatro"[..], &b"cinco"[..]] {
            std::thread::sleep(std::time::Duration::from_millis(5));
            save_with_retention(root.path(), path, content, true, Some(2)).unwrap();
        }

        assert_eq!(fs::read(root.path().join(path)).unwrap(), b"cinco");
        let versions = list_backups(root.path(), path).unwrap();
        assert_eq!(versions.len(), 2);
        let values: Vec<_> = versions
            .iter()
            .map(|version| fs::read(root.path().join(BACKUPS).join(version).join(path)).unwrap())
            .collect();
        assert_eq!(values, [b"cuatro".to_vec(), b"tres".to_vec()]);
        assert_eq!(
            fs::read_dir(root.path().join(BACKUPS)).unwrap().count(),
            3,
            "se conservan las dos versiones recientes y la copia del otro archivo"
        );
        assert_eq!(
            list_backups(root.path(), "otro.txt").unwrap().len(),
            1,
            "la retención de un archivo no elimina copias de otro"
        );
    }

    #[test]
    fn retencion_desactivada_conserva_historial_y_se_validan_limites() {
        let root = tempfile::tempdir().unwrap();
        let path = "nota.txt";
        save_with_retention(root.path(), path, b"uno", true, None).unwrap();
        save_with_retention(root.path(), path, b"dos", true, None).unwrap();
        assert!(save_with_retention(root.path(), path, b"x", true, Some(0)).is_err());
        assert!(save_with_retention(root.path(), path, b"x", true, Some(101)).is_err());
        assert_eq!(list_backups(root.path(), path).unwrap().len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn las_rutas_de_directorios_con_puntos_de_reanalisis_se_rechazan() {
        use std::os::windows::fs::symlink_dir;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        symlink_dir(outside.path(), root.path().join("atajo")).unwrap();
        assert!(save(root.path(), "atajo/fuera.txt", b"cambio", true).is_err());
        assert!(!outside.path().join("fuera.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn un_archivo_bloqueado_conserva_su_contenido() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("doc.txt");
        fs::write(&target, b"original").unwrap();
        let held = File::options()
            .read(true)
            .share_mode(1)
            .open(&target)
            .unwrap();
        assert!(save(root.path(), "doc.txt", b"nuevo", true).is_err());
        drop(held);
        assert_eq!(fs::read(target).unwrap(), b"original");
        assert_eq!(root.path().join(BACKUPS).read_dir().unwrap().count(), 0);
    }

    #[test]
    fn limpia_solo_las_copias_del_archivo_confirmado() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "a.txt", b"a0", true).unwrap();
        save(root.path(), "a.txt", b"a1", true).unwrap();
        save(root.path(), "b.txt", b"b0", true).unwrap();
        save(root.path(), "b.txt", b"b1", true).unwrap();
        assert!(clear_backups(root.path(), "a.txt", false).is_err());
        assert_eq!(clear_backups(root.path(), "a.txt", true).unwrap(), 1);
        assert!(list_backups(root.path(), "a.txt").unwrap().is_empty());
        assert_eq!(list_backups(root.path(), "b.txt").unwrap().len(), 1);
        assert_eq!(fs::read(root.path().join("a.txt")).unwrap(), b"a1");
    }

    #[test]
    fn restaura_una_copia_y_conserva_el_archivo_reemplazado() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), "src/config.json", b"antes", true).unwrap();
        save(root.path(), "src/config.json", b"actual", true).unwrap();
        let versions = list_backups(root.path(), "src/config.json").unwrap();
        assert_eq!(versions.len(), 1);
        assert!(restore(root.path(), "src/config.json", &versions[0], false).is_err());
        restore(root.path(), "src/config.json", &versions[0], true).unwrap();
        assert_eq!(
            fs::read(root.path().join("src/config.json")).unwrap(),
            b"antes"
        );
        assert_eq!(
            list_backups(root.path(), "src/config.json").unwrap().len(),
            2
        );
        assert!(restore(root.path(), "src/config.json", "../../fuera", true).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn ignora_enlaces_simbolicos_en_las_copias() {
        use std::os::windows::fs::symlink_file;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        let version = root.path().join(BACKUPS).join("edicion-prueba");
        fs::create_dir_all(&version).unwrap();
        symlink_file(outside.path(), version.join("secreto.txt")).unwrap();
        assert!(list_backups(root.path(), "secreto.txt").unwrap().is_empty());
    }

    #[test]
    fn las_aprobaciones_simultaneas_conservan_cada_version() {
        let root = tempfile::tempdir().unwrap();
        let path = "nota.txt";
        save(root.path(), path, b"A", true).unwrap();
        std::thread::scope(|scope| {
            for text in [b"B", b"C"] {
                let dir = root.path();
                scope.spawn(move || save(dir, path, text, true).unwrap());
            }
        });
        let mut versions = vec![fs::read(root.path().join(path)).unwrap()];
        versions.extend(
            root.path()
                .join(BACKUPS)
                .read_dir()
                .unwrap()
                .map(|entry| fs::read(entry.unwrap().path().join(path)).unwrap()),
        );
        versions.sort();
        assert_eq!(versions, [b"A", b"B", b"C"]);
    }
}
