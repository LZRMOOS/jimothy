mod commands;
mod crypto;
mod notes;
mod platform;
mod storage;
mod watcher;

use commands::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit Scratch", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Notes", true, None::<&str>)?;
            let new_note =
                MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_note, &quit])?;

            TrayIconBuilder::new()
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
                    _ => {}
                })
                .build(app)?;

            // Register global shortcut
            let shortcut_str = platform::default_shortcut();
            if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
                let h = handle.clone();
                app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = h.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
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
