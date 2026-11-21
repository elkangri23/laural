use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::command;

const MAX_STATUS_BYTES: usize = 128 * 1024;
const MAX_DIFF_BYTES: usize = 160 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    root: String,
    branch: String,
    changes: Vec<GitChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitChange {
    code: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    content: String,
    truncated: bool,
}

struct CommandOutput {
    stdout: Vec<u8>,
    truncated: bool,
}

#[command]
pub fn get_git_status(project_path: String) -> Result<GitStatus, String> {
    let root = repository_root(Path::new(&project_path))?;
    let output = run_git(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=normal",
        ],
        MAX_STATUS_BYTES,
    )?;
    if output.truncated {
        return Err("El estado Git supera el límite de lectura permitido.".into());
    }
    parse_status(&root, &output.stdout)
}

#[command]
pub fn get_git_diff(project_path: String) -> Result<GitDiff, String> {
    let root = repository_root(Path::new(&project_path))?;
    let unstaged = run_git(
        &root,
        &[
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "--",
        ],
        MAX_DIFF_BYTES,
    )?;
    let staged = run_git(
        &root,
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "--",
        ],
        MAX_DIFF_BYTES,
    )?;
    let mut content = String::new();
    if !staged.stdout.is_empty() {
        content.push_str("# Cambios preparados\n");
        content.push_str(&String::from_utf8_lossy(&staged.stdout));
    }
    if !unstaged.stdout.is_empty() {
        if !content.is_empty() {
            content.push_str("\n\n");
        }
        content.push_str("# Cambios sin preparar\n");
        content.push_str(&String::from_utf8_lossy(&unstaged.stdout));
    }
    let truncated = staged.truncated || unstaged.truncated || content.len() > MAX_DIFF_BYTES;
    if content.len() > MAX_DIFF_BYTES {
        truncate_utf8(&mut content, MAX_DIFF_BYTES);
    }
    Ok(GitDiff { content, truncated })
}

fn repository_root(project_path: &Path) -> Result<PathBuf, String> {
    let project = project_path
        .canonicalize()
        .map_err(|_| "La carpeta seleccionada ya no está disponible.".to_string())?;
    if !project.is_dir() {
        return Err("Selecciona una carpeta de proyecto válida.".into());
    }
    let output = run_git(&project, &["rev-parse", "--show-toplevel"], 32 * 1024)?;
    if output.truncated {
        return Err("Git devolvió una ruta de repositorio demasiado larga.".into());
    }
    let root = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let root = root
        .canonicalize()
        .map_err(|_| "No se pudo validar la raíz del repositorio.".to_string())?;
    if !root.is_dir() {
        return Err("La raíz del repositorio no es una carpeta válida.".into());
    }
    Ok(root)
}

fn parse_status(root: &Path, bytes: &[u8]) -> Result<GitStatus, String> {
    let output = std::str::from_utf8(bytes)
        .map_err(|_| "Git devolvió un estado que no se pudo interpretar.".to_string())?;
    let mut lines = output.lines();
    let branch_line = lines
        .next()
        .and_then(|line| line.strip_prefix("## "))
        .ok_or_else(|| "Git devolvió un estado incompleto.".to_string())?;
    let branch = branch_line
        .split("...")
        .next()
        .unwrap_or(branch_line)
        .to_string();
    let changes = lines
        .filter_map(|line| {
            let status = line.get(..2)?;
            let path = line.get(3..)?;
            Some(GitChange {
                code: status.trim().to_string(),
                path: path.to_string(),
            })
        })
        .collect();
    Ok(GitStatus {
        root: root.to_string_lossy().into_owned(),
        branch,
        changes,
    })
}

fn run_git(directory: &Path, args: &[&str], max_bytes: usize) -> Result<CommandOutput, String> {
    let mut command = Command::new("git");
    command
        .current_dir(directory)
        .args([
            "--no-pager",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "diff.external=",
            "-c",
            "diff.trustExitCode=false",
        ])
        .args(args)
        .env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "NUL")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in ["PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command.spawn().map_err(|_| {
        "No se pudo iniciar Git. Instala Git for Windows y vuelve a intentarlo.".to_string()
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo leer la respuesta de Git.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "No se pudo leer el error de Git.".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, max_bytes));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, 4 * 1024));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "No se pudo consultar el proceso Git.".to_string())?
        {
            break Some(status);
        }
        if start.elapsed() >= COMMAND_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "Falló la lectura de la salida de Git.".to_string())?
        .map_err(|_| "No se pudo leer la salida de Git.".to_string())?;
    let (stderr, _) = stderr_reader
        .join()
        .map_err(|_| "Falló la lectura del error de Git.".to_string())?
        .map_err(|_| "No se pudo leer el error de Git.".to_string())?;
    if status.is_none() {
        return Err("Git tardó demasiado y se canceló la consulta.".into());
    }
    if !status.is_some_and(|status| status.success()) && !stdout_truncated {
        let message = String::from_utf8_lossy(&stderr);
        if message.contains("not a git repository") || message.contains("no es un repositorio git")
        {
            return Err("La carpeta seleccionada no contiene un repositorio Git.".into());
        }
        return Err("Git no pudo completar la consulta de solo lectura.".into());
    }
    Ok(CommandOutput {
        stdout,
        truncated: stdout_truncated,
    })
}

fn read_bounded(mut reader: impl Read, max_bytes: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::with_capacity(max_bytes.min(16 * 1024));
    reader
        .by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);
    Ok((bytes, truncated))
}

fn truncate_utf8(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn interpreta_rama_y_cambios_porcelain_sin_invocar_shell() {
        let status = b"## feature/panel...origin/feature/panel [ahead 1]\n M src/App.tsx\nA  tests/git-panel.test.tsx\n?? docs/git/\n";
        let parsed = parse_status(Path::new("C:/proyecto"), status).unwrap();
        assert_eq!(parsed.branch, "feature/panel");
        assert_eq!(parsed.changes.len(), 3);
        assert_eq!(parsed.changes[0].code, "M");
        assert_eq!(parsed.changes[0].path, "src/App.tsx");
        assert_eq!(parsed.changes[2].code, "??");
    }

    #[test]
    fn limita_los_bytes_de_salida_y_marca_el_recorte() {
        let (content, truncated) = read_bounded("demasiado largo".as_bytes(), 5).unwrap();
        assert_eq!(content, b"demas");
        assert!(truncated);
        let (content, truncated) = read_bounded("corto".as_bytes(), 5).unwrap();
        assert_eq!(content, b"corto");
        assert!(!truncated);
    }

    #[test]
    fn no_acepta_salida_de_estado_sin_cabecera_de_rama() {
        assert!(parse_status(Path::new("."), b" M src/App.tsx\n").is_err());
    }

    #[test]
    fn recorta_diff_sin_partir_caracteres_utf8() {
        let mut value = "aá".to_string();
        truncate_utf8(&mut value, 2);
        assert_eq!(value, "a");
    }

    #[test]
    fn consulta_un_repositorio_real_sin_alterar_su_indice() {
        let directory = tempfile::tempdir().unwrap();
        let repository = directory.path();
        let init = Command::new("git")
            .current_dir(repository)
            .args(["init", "-q"])
            .status();
        let Ok(init) = init else { return };
        assert!(init.success());
        fs::write(repository.join("archivo.txt"), "primera versión\n").unwrap();
        assert!(
            Command::new("git")
                .current_dir(repository)
                .args(["add", "archivo.txt"])
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("git")
                .current_dir(repository)
                .args([
                    "-c",
                    "user.name=Laural Tests",
                    "-c",
                    "user.email=laural-tests@example.invalid",
                    "commit",
                    "-qm",
                    "base",
                ])
                .status()
                .unwrap()
                .success()
        );
        fs::write(repository.join("archivo.txt"), "versión modificada\n").unwrap();

        let root = repository_root(repository).unwrap();
        let status = run_git(
            &root,
            &[
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=normal",
            ],
            MAX_STATUS_BYTES,
        )
        .unwrap();
        let parsed = parse_status(&root, &status.stdout).unwrap();
        assert_eq!(parsed.changes.len(), 1);
        assert_eq!(parsed.changes[0].code, "M");
        assert!(String::from_utf8_lossy(&status.stdout).contains(" M archivo.txt"));
        let diff = run_git(
            &root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--no-color",
                "--unified=3",
                "--",
            ],
            MAX_DIFF_BYTES,
        )
        .unwrap();
        assert!(String::from_utf8_lossy(&diff.stdout).contains("versión modificada"));
    }
}
