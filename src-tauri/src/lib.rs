use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::Manager;

struct ServerProcess(Mutex<Option<Child>>);

#[derive(Serialize, Deserialize, Default)]
struct DgConfig {
    #[serde(default = "default_shell")]
    shell: String,
}

fn default_shell() -> String {
    "native".to_string()
}

fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".demogod")
        .join("config.json")
}

fn read_config() -> DgConfig {
    let path = config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    DgConfig::default()
}

fn spawn_server(shell: &str) -> Result<Child, String> {
    let result = match shell {
        "wsl" => Command::new("wsl")
            .args(["--", "node", "--import", "tsx", "src/server.ts"])
            .spawn(),
        "powershell" => Command::new("powershell")
            .args(["-NoProfile", "-Command", "node --import tsx src/server.ts"])
            .spawn(),
        "cmd" => Command::new("cmd")
            .args(["/c", "node --import tsx src/server.ts"])
            .spawn(),
        _ => Command::new("node")
            .args(["--import", "tsx", "src/server.ts"])
            .spawn(),
    };
    result.map_err(|e| format!("Failed to start server via {}: {}", shell, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if !cfg!(debug_assertions) {
                let config = read_config();
                let shell = config.shell.as_str();
                log::info!("Starting server via shell: {}", shell);
                match spawn_server(shell) {
                    Ok(child) => {
                        app.manage(ServerProcess(Mutex::new(Some(child))));
                    }
                    Err(e) => {
                        log::error!("{}", e);
                        // Try native fallback
                        log::info!("Falling back to native shell...");
                        let child = spawn_server("native")
                            .expect("Failed to start server with any shell");
                        app.manage(ServerProcess(Mutex::new(Some(child))));
                    }
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<ServerProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut process) = guard.take() {
                            let _ = process.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
