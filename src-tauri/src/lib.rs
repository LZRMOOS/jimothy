mod commands;
mod crypto;
mod notes;
mod platform;
mod storage;
mod watcher;

use commands::AppState;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let id = TrayIconId::new("main-tray");
    if let Some(tray) = app.tray_by_id(&id) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;

    let parsed: Shortcut = shortcut.parse().map_err(|e| format!("{e:?}"))?;
    let h = app.clone();
    gs.on_shortcut(parsed, move |_app, _shortcut, event| {
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
    }).map_err(|e| e.to_string())?;

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
        .menu(|app| {
            let app_menu = Submenu::with_items(
                app,
                "Jimothy",
                true,
                &[
                    &MenuItem::with_id(app, "about", "About Jimothy", true, None::<&str>)?,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "menu_settings", "Settings...", true, Some("CmdOrCtrl+,"))?,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &tauri::menu::PredefinedMenuItem::hide(app, None)?,
                    &tauri::menu::PredefinedMenuItem::hide_others(app, None)?,
                    &tauri::menu::PredefinedMenuItem::show_all(app, None)?,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &tauri::menu::PredefinedMenuItem::quit(app, None)?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &tauri::menu::PredefinedMenuItem::undo(app, None)?,
                    &tauri::menu::PredefinedMenuItem::redo(app, None)?,
                    &tauri::menu::PredefinedMenuItem::separator(app)?,
                    &tauri::menu::PredefinedMenuItem::cut(app, None)?,
                    &tauri::menu::PredefinedMenuItem::copy(app, None)?,
                    &tauri::menu::PredefinedMenuItem::paste(app, None)?,
                    &tauri::menu::PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &MenuItem::with_id(app, "menu_new_note", "New Note", true, Some("CmdOrCtrl+N"))?,
                    &MenuItem::with_id(app, "menu_lock", "Lock Vault", true, None::<&str>)?,
                ],
            )?;
            Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu])
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "menu_lock" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("lock-vault", ());
                    }
                }
                "menu_new_note" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("create-new-note", ());
                    }
                }
                "menu_settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("open-settings", ());
                    }
                }
                _ => {}
            }
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::set_notes_folder,
            commands::get_notes_folder,
            commands::get_notes,
            commands::create_note,
            commands::save_note,
            commands::set_note_archived,
            commands::delete_note,
            commands::reload_notes,
            commands::get_default_notes_path,
            commands::get_app_settings,
            commands::save_app_settings,
            commands::get_preferences,
            commands::save_preferences,
            commands::setup_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::get_vault_status,
            commands::change_vault_password,
            commands::disable_vault,
            commands::verify_password,
            commands::set_active_note,
            commands::restore_from_trash,
            commands::get_protection_status,
            commands::setup_protection,
            commands::unlock_protection,
            commands::verify_protection_password,
            commands::protect_note,
            commands::unprotect_note,
            commands::get_protected_note_body,
            commands::save_protected_note,
            commands::disable_protection,
            commands::change_protection_password,
            set_tray_visible,
            update_global_shortcut,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit Jimothy", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Notes", true, None::<&str>)?;
            let new_note =
                MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Lock Vault", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_note, &lock, &settings, &quit])?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png")).unwrap();
            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Jimothy")
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

            // Register global shortcut (load from settings or use default)
            let shortcut_str = {
                let config_dir = dirs::config_dir().unwrap_or_default();
                let settings_path = config_dir.join("jimothy").join("settings.json");
                settings_path
                    .exists()
                    .then(|| std::fs::read_to_string(&settings_path).ok())
                    .flatten()
                    .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                    .and_then(|v| v.get("globalShortcut")?.as_str().map(String::from))
                    .unwrap_or_else(|| platform::default_shortcut().to_string())
            };
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

            // Show window on startup unless autostart is enabled (launch minimized to tray)
            let autostart_enabled = app.handle().autolaunch().is_enabled().unwrap_or(false);
            if !autostart_enabled {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
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
