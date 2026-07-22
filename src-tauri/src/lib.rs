mod commands;
mod crypto;
mod notes;
mod platform;
mod storage;
mod watcher;

use commands::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let id = TrayIconId::new("main-tray");
    if let Some(tray) = app.tray_by_id(&id) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod power_events;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::set_notes_folder,
            commands::get_notes_folder,
            commands::get_notes,
            commands::create_note,
            commands::save_note,
            commands::delete_note,
            commands::reload_notes,
            commands::get_default_notes_path,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::setup_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::get_vault_status,
            commands::change_vault_password,
            commands::set_active_note,
            commands::restore_from_trash,
            set_tray_visible,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit Scratch", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Notes", true, None::<&str>)?;
            let new_note =
                MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Lock Vault", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_note, &lock, &settings, &quit])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .tooltip("Scratch")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new_note" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("create-new-note", ());
                        }
                    }
                    "lock" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("lock-vault", ());
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("open-settings", ());
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Listen for system sleep/screen lock to auto-lock vault
            #[cfg(target_os = "macos")]
            {
                let sleep_handle = handle.clone();
                std::thread::spawn(move || {
                    power_events::listen_for_sleep(sleep_handle);
                });
            }

            // Register global shortcut
            let shortcut_str = platform::default_shortcut();
            if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
                let h = handle.clone();
                app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = h.get_webview_window("main") {
                            if window.is_minimized().unwrap_or(false) {
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            } else if window.is_visible().unwrap_or(false) {
                                if window.is_focused().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.set_focus();
                                }
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
