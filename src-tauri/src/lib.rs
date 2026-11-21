use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

mod account;
mod activity_log;
mod agent_files;
mod chat_stream;
mod configuration_transfer;
pub mod preferences;
mod providers;
mod sync;

struct TerminalIo {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

struct TerminalSession {
    io: Arc<Mutex<TerminalIo>>,
    child: Box<dyn Child + Send + Sync>,
    shell: String,
}

#[derive(Default)]
struct PtyStore {
    state: Mutex<PtyState>,
}

#[derive(Default)]
struct PtyState {
    sessions: HashMap<String, TerminalSession>,
    shutting_down: bool,
}

const MAX_TERMINAL_ID_BYTES: usize = 100;
const MAX_TERMINAL_INPUT_BYTES: usize = 1_000_000;

fn valid_terminal_id(terminal_id: &str) -> bool {
    !terminal_id.trim().is_empty()
        && terminal_id.len() <= MAX_TERMINAL_ID_BYTES
        && !terminal_id.chars().any(char::is_control)
}

fn validate_terminal_input(data: &str) -> Result<(), String> {
    if data.len() > MAX_TERMINAL_INPUT_BYTES {
        Err("La entrada supera el límite de 1 MB por envío.".into())
    } else {
        Ok(())
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) && self.child.kill().is_ok() {
            let _ = self.child.wait();
        }
    }
}

impl PtyStore {
    fn shutdown(&self) {
        let sessions = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.shutting_down = true;
            std::mem::take(&mut state.sessions)
        };
        drop(sessions);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    terminal_id: String,
    data: Vec<u8>,
}

fn git_bash_path() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("ProgramFiles").map(|root| PathBuf::from(root).join("Git/bin/bash.exe")),
        std::env::var_os("LOCALAPPDATA")
            .map(|root| PathBuf::from(root).join("Programs/Git/bin/bash.exe")),
        Some(PathBuf::from(r"C:\Program Files\Git\bin\bash.exe")),
    ];

    candidates.into_iter().flatten().find(|path| path.is_file())
}

const BASH_PROMPT_COMMAND: &str =
    r#"__laural_status=$?; printf '\033]133;D;%s\007' "$__laural_status""#;

fn shell_command(shell: &str) -> Result<CommandBuilder, String> {
    match shell {
        "powershell" => {
            let mut command = CommandBuilder::new("powershell.exe");
            command.arg("-NoLogo");
            command.arg("-NoExit");
            command.arg("-Command");
            command.arg(r#"
                $global:__lauralLastHistoryId = $null
                $global:__lauralOriginalPrompt = $function:prompt
                function global:prompt {
                    $success = $?
                    $last = Get-History -Count 1
                    $code = if ($success) { 0 } elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }
                    $out = ''
                    if ($null -ne $global:__lauralLastHistoryId) {
                        if ($last -and $last.Id -ne $global:__lauralLastHistoryId) { $out += "$([char]27)]133;D;$code`a" }
                        else { $out += "$([char]27)]133;D`a" }
                    }
                    $out += "$([char]27)]133;A`a"
                    if ($global:__lauralOriginalPrompt) { $out += (& $global:__lauralOriginalPrompt) }
                    else { $out += "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
                    $out += "$([char]27)]133;B`a"
                    $global:__lauralLastHistoryId = if ($last) { $last.Id } else { 0 }
                    return $out
                }
            "#);
            Ok(command)
        }
        "cmd" => {
            let mut command = CommandBuilder::new("cmd.exe");
            let existing_prompt = std::env::var("PROMPT").unwrap_or_else(|_| "$P$G".to_string());
            command.env(
                "PROMPT",
                format!("$E]133;D$E\\$E]133;A$E\\{existing_prompt}$E]133;B$E\\"),
            );
            Ok(command)
        }
        "wsl" => {
            let mut command = CommandBuilder::new("wsl.exe");
            command.env("PROMPT_COMMAND", BASH_PROMPT_COMMAND);
            let existing = std::env::var("WSLENV").unwrap_or_default();
            let wsl_env = if existing
                .split(':')
                .any(|item| item.split('/').next() == Some("PROMPT_COMMAND"))
            {
                existing
            } else if existing.is_empty() {
                "PROMPT_COMMAND".to_string()
            } else {
                format!("{existing}:PROMPT_COMMAND")
            };
            command.env("WSLENV", wsl_env);
            Ok(command)
        }
        "git-bash" => {
            let path = git_bash_path().ok_or_else(|| {
                "No encuentro Git Bash. Instala Git for Windows o revisa su ubicación.".to_string()
            })?;
            let mut command = CommandBuilder::new(path);
            command.args(["--login", "-i"]);
            command.env("PROMPT_COMMAND", BASH_PROMPT_COMMAND);
            Ok(command)
        }
        _ => Err("Shell no admitido.".to_string()),
    }
}

#[tauri::command]
fn create_terminal(
    app: AppHandle,
    state: State<'_, PtyStore>,
    terminal_id: String,
    shell: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if !valid_terminal_id(&terminal_id) {
        return Err("El identificador de la terminal no es válido.".to_string());
    }

    let mut state = state
        .state
        .lock()
        .map_err(|_| "No se pudo acceder al registro de terminales.".to_string())?;
    if state.shutting_down {
        return Err("Laural se está cerrando.".into());
    }
    if state.sessions.contains_key(&terminal_id) {
        return Ok(());
    }

    let mut command = shell_command(&shell)?;
    if let Some(cwd) = cwd {
        let path = Path::new(&cwd);
        if !path.is_dir() {
            return Err("La carpeta de inicio no existe.".to_string());
        }
        command.cwd(path);
    } else if let Some(home) = std::env::var_os("USERPROFILE") {
        command.cwd(home);
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.clamp(8, 200),
            cols: cols.clamp(20, 400),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("No se pudo crear la terminal: {error}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("No se pudo leer la terminal: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("No se pudo escribir en la terminal: {error}"))?;

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("No se pudo iniciar el shell: {error}"))?;
    let session = TerminalSession {
        io: Arc::new(Mutex::new(TerminalIo {
            master: pair.master,
            writer,
        })),
        child,
        shell: shell.clone(),
    };
    let reader_id = terminal_id.clone();
    thread::Builder::new()
        .name(format!("laural-pty-{terminal_id}"))
        .spawn(move || {
            let terminal_id = reader_id;
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(length) => {
                        if app
                            .emit(
                                "terminal-output",
                                TerminalOutput {
                                    terminal_id: terminal_id.clone(),
                                    data: buffer[..length].to_vec(),
                                },
                            )
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            let _ = app.emit("terminal-exit", terminal_id);
        })
        .map_err(|error| format!("No se pudo iniciar la lectura de la terminal: {error}"))?;

    state.sessions.insert(terminal_id, session);
    Ok(())
}

#[tauri::command]
fn write_terminal(
    state: State<'_, PtyStore>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    validate_terminal_input(&data)?;
    let session = state
        .state
        .lock()
        .map_err(|_| "No se pudo acceder al registro de terminales.".to_string())?
        .sessions
        .get(&terminal_id)
        .map(|session| Arc::clone(&session.io))
        .ok_or_else(|| "La terminal ya no está disponible.".to_string())?;
    let mut session = session
        .lock()
        .map_err(|_| "No se pudo escribir en la terminal.".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| format!("No se pudo escribir en la terminal: {error}"))
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, PtyStore>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let session = state
        .state
        .lock()
        .map_err(|_| "No se pudo acceder al registro de terminales.".to_string())?
        .sessions
        .get(&terminal_id)
        .map(|session| Arc::clone(&session.io))
        .ok_or_else(|| "La terminal ya no está disponible.".to_string())?;
    let session = session
        .lock()
        .map_err(|_| "No se pudo redimensionar la terminal.".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.clamp(8, 200),
            cols: cols.clamp(20, 400),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("No se pudo redimensionar la terminal: {error}"))
}

#[tauri::command]
fn close_terminal(state: State<'_, PtyStore>, terminal_id: String) -> Result<(), String> {
    let mut state = state
        .state
        .lock()
        .map_err(|_| "No se pudo acceder al registro de terminales.".to_string())?;
    let session = state.sessions.remove(&terminal_id);
    drop(state);
    drop(session);
    Ok(())
}

#[tauri::command]
fn run_agent_command(
    app: AppHandle,
    state: State<'_, PtyStore>,
    terminal_id: String,
    command: String,
    approved: bool,
) -> Result<(), String> {
    let sessions = state
        .state
        .lock()
        .map_err(|_| "No se pudo acceder al registro de terminales.".to_string())?;
    let terminal = sessions
        .sessions
        .get(&terminal_id)
        .ok_or_else(|| "La terminal seleccionada ya no está disponible.".to_string())?;
    if let Err(error) =
        providers::authorize_agent_command(&app, &terminal.shell, &command, approved)
    {
        activity_log::record(
            &app,
            activity_log::ActivityAction::Command,
            activity_log::ActivityOutcome::Rejected,
        );
        return Err(error);
    }
    let session = Arc::clone(&terminal.io);
    drop(sessions);
    let mut session = session
        .lock()
        .map_err(|_| "No se pudo escribir en la terminal.".to_string())?;
    let mut input = command.trim().to_string();
    input.push('\r');
    let result = session
        .writer
        .write_all(input.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| format!("No se pudo enviar el comando: {error}"));
    activity_log::record(
        &app,
        activity_log::ActivityAction::Command,
        if result.is_ok() {
            activity_log::ActivityOutcome::Submitted
        } else {
            activity_log::ActivityOutcome::Failed
        },
    );
    result
}

#[tauri::command]
fn apply_agent_file(
    app: AppHandle,
    project_path: String,
    relative_path: String,
    content: String,
    approved: bool,
) -> Result<String, String> {
    let keep_backups = providers::get_agent_settings(app.clone())?.backup_retention;
    let result = agent_files::save_with_retention(
        Path::new(&project_path),
        &relative_path,
        content.as_bytes(),
        approved,
        keep_backups,
    );
    activity_log::record(
        &app,
        activity_log::ActivityAction::FileWrite,
        if result.is_ok() {
            activity_log::ActivityOutcome::Completed
        } else if !approved {
            activity_log::ActivityOutcome::Rejected
        } else {
            activity_log::ActivityOutcome::Failed
        },
    );
    result
}

#[tauri::command]
fn list_agent_backups(project_path: String, relative_path: String) -> Result<Vec<String>, String> {
    agent_files::list_backups(Path::new(&project_path), &relative_path)
}

#[tauri::command]
fn restore_agent_backup(
    app: AppHandle,
    project_path: String,
    relative_path: String,
    version: String,
    approved: bool,
) -> Result<String, String> {
    let keep_backups = providers::get_agent_settings(app.clone())?.backup_retention;
    let result = agent_files::restore_with_retention(
        Path::new(&project_path),
        &relative_path,
        &version,
        approved,
        keep_backups,
    );
    activity_log::record(
        &app,
        activity_log::ActivityAction::FileRestore,
        if result.is_ok() {
            activity_log::ActivityOutcome::Completed
        } else if !approved {
            activity_log::ActivityOutcome::Rejected
        } else {
            activity_log::ActivityOutcome::Failed
        },
    );
    result
}
#[tauri::command]
fn clear_agent_backups(
    app: AppHandle,
    project_path: String,
    relative_path: String,
    approved: bool,
) -> Result<usize, String> {
    let result = agent_files::clear_backups(Path::new(&project_path), &relative_path, approved);
    activity_log::record(
        &app,
        activity_log::ActivityAction::BackupCleanup,
        if result.is_ok() {
            activity_log::ActivityOutcome::Completed
        } else if !approved {
            activity_log::ActivityOutcome::Rejected
        } else {
            activity_log::ActivityOutcome::Failed
        },
    );
    result
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtyStore::default())
        .manage(providers::ChatStreamRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            account::account_session_status,
            account::start_account_login,
            account::clear_account_session,
            sync::read_remote_preferences,
            sync::write_remote_preferences,
            sync::confirm_remote_preferences,
            sync::sync_local_preferences,
            sync::get_preference_sync_status,
            create_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            activity_log::get_agent_activity,
            activity_log::clear_agent_activity,
            run_agent_command,
            apply_agent_file,
            list_agent_backups,
            restore_agent_backup,
            clear_agent_backups,
            providers::get_provider,
            providers::get_providers,
            providers::export_configuration,
            providers::get_preference_snapshot,
            providers::apply_remote_preference_snapshot,
            providers::import_configuration,
            providers::preview_configuration,
            providers::select_provider,
            providers::test_provider,
            providers::save_provider,
            providers::send_chat,
            providers::send_chat_stream,
            providers::cancel_chat_stream,
            providers::cancel_agent_plan,
            providers::preview_context,
            providers::get_agent_settings,
            providers::save_agent_settings,
            providers::plan_agent
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<PtyStore>().shutdown();
            }
        });
}

#[cfg(all(test, windows))]
mod terminal_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn limita_identificadores_y_entradas_de_terminal() {
        assert!(valid_terminal_id("sesion-1"));
        assert!(!valid_terminal_id(&"x".repeat(MAX_TERMINAL_ID_BYTES + 1)));
        assert!(!valid_terminal_id("sesion\n1"));
        assert!(validate_terminal_input(&"x".repeat(MAX_TERMINAL_INPUT_BYTES)).is_ok());
        assert!(validate_terminal_input(&"x".repeat(MAX_TERMINAL_INPUT_BYTES + 1)).is_err());
    }

    #[test]
    fn el_cierre_de_la_aplicacion_termina_el_shell_con_la_entrada_ocupada() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let child = pair
            .slave
            .spawn_command(CommandBuilder::new("cmd.exe"))
            .unwrap();
        drop(pair.slave);
        let io = Arc::new(Mutex::new(TerminalIo {
            master: pair.master,
            writer,
        }));
        let store = PtyStore::default();
        store.state.lock().unwrap().sessions.insert(
            "sesion".into(),
            TerminalSession {
                io: Arc::clone(&io),
                child,
                shell: "cmd".into(),
            },
        );
        let (done, result) = mpsc::channel();
        let busy = io.lock().unwrap();
        let shutdown = thread::spawn(move || {
            store.shutdown();
            store.shutdown();
            let state = store.state.lock().unwrap();
            done.send(state.shutting_down && state.sessions.is_empty())
                .unwrap();
        });
        let closed = result.recv_timeout(Duration::from_secs(10));
        drop(busy);
        drop(io);
        assert!(closed.expect("el cierre quedó bloqueado por la entrada"));
        shutdown.join().unwrap();
        let (eof, result) = mpsc::channel();
        thread::spawn(move || {
            let mut bytes = [0; 4096];
            while matches!(reader.read(&mut bytes), Ok(n) if n > 0) {}
            let _ = eof.send(());
        });
        result
            .recv_timeout(Duration::from_secs(10))
            .expect("el lector sigue abierto");
    }

    // WSL and Git Bash are optional installations on end-user machines and CI runners.
    #[test]
    #[ignore = "requiere PowerShell, CMD, Git Bash y una distribución WSL instalados"]
    fn ciclo_de_vida_de_los_cuatro_shells() {
        for shell in ["cmd", "powershell", "git-bash", "wsl"] {
            let pair = native_pty_system().openpty(PtySize::default()).unwrap();
            let mut reader = pair.master.try_clone_reader().unwrap();
            let mut writer = pair.master.take_writer().unwrap();
            let mut child = pair
                .slave
                .spawn_command(shell_command(shell).unwrap())
                .unwrap();
            drop(pair.slave);
            let (sent, received) = mpsc::channel();
            thread::spawn(move || {
                let mut chunk = [0; 4096];
                while let Ok(count) = reader.read(&mut chunk) {
                    if count == 0 || sent.send(chunk[..count].to_vec()).is_err() {
                        break;
                    }
                }
            });
            pair.master
                .resize(PtySize {
                    rows: 42,
                    cols: 100,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            let deadline = Instant::now() + Duration::from_secs(45);
            let mut output = Vec::new();
            let mut entered = false;
            let mut sent_exit = false;
            let tail = b"LAURAL-1500-final";
            let status = loop {
                if let Some(status) = child.try_wait().unwrap() {
                    break Some(status.exit_code());
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                if let Ok(bytes) = received.recv_timeout(Duration::from_millis(50)) {
                    output.extend(bytes);
                    if let Some(pos) = output.windows(4).position(|s| s == b"\x1b[6n") {
                        writer.write_all(b"\x1b[1;1R").unwrap();
                        writer.flush().unwrap();
                        output.drain(..pos + 4);
                    }
                    if !entered
                        && output
                            .windows(4)
                            .any(|s| s == b"133;" || s == b"$ \x1b[" || s == b"PS C")
                    {
                        let script = match shell {
                            "cmd" => {
                                "for /L %i in (1,1,1500) do @echo LAURAL-%i-final-abcdefghijklmnopqrstuvwxyz\r"
                            }
                            "powershell" => {
                                "1..1500 | ForEach-Object { \"LAURAL-$_-final-abcdefghijklmnopqrstuvwxyz\" }\r"
                            }
                            _ => {
                                "for ((i=1;i<=1500;i++)); do printf 'LAURAL-%d-final-abcdefghijklmnopqrstuvwxyz\\n' \"$i\"; done\r"
                            }
                        };
                        output.clear();
                        writer.write_all(script.as_bytes()).unwrap();
                        writer.flush().unwrap();
                        entered = true;
                    }
                    if entered
                        && !sent_exit
                        && output.len() > 24_000
                        && output.windows(tail.len()).any(|part| part == tail)
                    {
                        writer.write_all(b"exit 37\r").unwrap();
                        writer.flush().unwrap();
                        sent_exit = true;
                    }
                }
            };
            assert_eq!(
                status,
                Some(37),
                "{shell}: prompt reconocido={entered}; bytes de salida={}",
                output.len()
            );
            println!(
                "{shell}: {} bytes, última línea recibida y cierre correcto",
                output.len()
            );
        }
    }
}
