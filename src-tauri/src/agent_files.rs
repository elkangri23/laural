use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
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

pub(crate) fn save(
    root: &Path,
    relative: &str,
    content: &[u8],
    approved: bool,
) -> Result<String, String> {
    if !approved {
        return Err("Los cambios de archivos requieren aprobación explícita.".into());
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
    write_file(root, relative, content)
        .map_err(|e| format!("No se pudo guardar {}: {e}", relative.display()))
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
