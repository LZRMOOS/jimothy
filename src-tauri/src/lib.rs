mod commands;
mod crypto;
mod notes;
mod pin;
mod platform;
mod storage;
mod watcher;

use commands::AppState;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Read a boolean local setting straight from settings.json. The setup hook
/// decides startup visibility before the frontend loads, so it can't go through
/// the usual IPC path. Returns None when the file is missing or the key is
/// unset, letting the caller fall back to a default.
fn read_bool_setting(key: &str) -> Option<bool> {
    let path = dirs::config_dir()?.join("jimothy").join("settings.json");
    let contents = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&contents).ok()?;
    json.get(key).and_then(|v| v.as_bool())
}

#[tauri::command]
fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    let id = TrayIconId::new("main-tray");
    if let Some(tray) = app.tray_by_id(&id) {
        tray.set_visible(visible).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn toggle_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
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

fn toggle_scratchpad(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("scratchpad") {
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
            let _ = window.center();
            let _ = window.set_focus();
        } else if window.is_visible().unwrap_or(false) {
            if window.is_focused().unwrap_or(false) {
                let _ = window.hide();
            } else {
                let _ = window.set_focus();
            }
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn open_scratchpad(app: tauri::AppHandle) -> Result<(), String> {
    toggle_scratchpad(&app);
    Ok(())
}

#[tauri::command]
fn read_shortcut_settings() -> serde_json::Value {
    let config_dir = dirs::config_dir().unwrap_or_default();
    let settings_path = config_dir.join("jimothy").join("settings.json");
    settings_path
        .exists()
        .then(|| std::fs::read_to_string(&settings_path).ok())
        .flatten()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .unwrap_or(serde_json::Value::Null)
}

fn register_shortcuts_with(app: &tauri::AppHandle, settings: &serde_json::Value) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;

    let get_str = |key: &str, default: &str| -> String {
        settings
            .get(key)
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| default.to_string())
    };

    let main1 = get_str("globalShortcut", platform::default_shortcut());
    let main2 = settings.get("globalShortcut2").and_then(|v| v.as_str().map(String::from));
    let cap1 = get_str("captureShortcut", platform::default_capture_shortcut());
    let cap2 = settings.get("captureShortcut2").and_then(|v| v.as_str().map(String::from));

    for s in [Some(main1), main2] {
        if let Some(s) = s {
            if let Ok(parsed) = s.parse::<Shortcut>() {
                let h = app.clone();
                if let Err(e) = gs.on_shortcut(parsed, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(&h, "main");
                    }
                }) {
                    eprintln!("Failed to register global shortcut '{}': {}", s, e);
                }
            }
        }
    }

    for s in [Some(cap1), cap2] {
        if let Some(s) = s {
            if let Ok(parsed) = s.parse::<Shortcut>() {
                let h = app.clone();
                if let Err(e) = gs.on_shortcut(parsed, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_scratchpad(&h);
                    }
                }) {
                    eprintln!("Failed to register capture shortcut '{}': {}", s, e);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn update_global_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    update_shortcut_inner(&app, "globalShortcut", &shortcut)
}

#[tauri::command]
fn update_capture_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    update_shortcut_inner(&app, "captureShortcut", &shortcut)
}

#[tauri::command]
fn update_shortcut(app: tauri::AppHandle, key: String, shortcut: String) -> Result<(), String> {
    let allowed = ["globalShortcut2", "captureShortcut2"];
    if !allowed.contains(&key.as_str()) {
        return Err("Invalid shortcut key".into());
    }
    update_shortcut_inner(&app, &key, &shortcut)
}

fn update_shortcut_inner(app: &tauri::AppHandle, key: &str, shortcut: &str) -> Result<(), String> {
    let mut settings = read_shortcut_settings();
    if shortcut.is_empty() {
        settings.as_object_mut().map(|o| o.remove(key));
    } else {
        shortcut.parse::<Shortcut>().map_err(|e| format!("{e:?}"))?;
        settings.as_object_mut().map(|o| o.insert(key.to_string(), shortcut.into()));
    }
    register_shortcuts_with(&app, &settings)
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
        // Let the plugin own geometry only (size / position / maximized). We
        // deliberately drop the VISIBLE flag so it never shows or hides the
        // window on its own — startup visibility is decided by our setup hook
        // below (launch-minimized-to-tray when autostart is on), and the tray /
        // close handlers own hide/show at runtime. With VISIBLE included the
        // plugin would re-show the window from saved state, defeating
        // launch-minimized and racing our own show()/hide() calls.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            )
        )
        .menu(|app| {
            #[cfg(target_os = "macos")]
            {
                // Create menu items
                let about = MenuItem::with_id(app, "about", "About Jimothy", true, None::<&str>)?;
                let settings_item = MenuItem::with_id(app, "menu_settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
                let new_note = MenuItem::with_id(app, "menu_new_note", "New Note", true, Some("CmdOrCtrl+N"))?;
                let lock_vault = MenuItem::with_id(app, "menu_lock", "Lock Vault", true, None::<&str>)?;

                // Create separators and predefined items
                let sep1 = PredefinedMenuItem::separator(app)?;
                let sep2 = PredefinedMenuItem::separator(app)?;
                let sep3 = PredefinedMenuItem::separator(app)?;
                let sep4 = PredefinedMenuItem::separator(app)?;
                let sep5 = PredefinedMenuItem::separator(app)?;

                let hide = PredefinedMenuItem::hide(app, None)?;
                let hide_others = PredefinedMenuItem::hide_others(app, None)?;
                let show_all = PredefinedMenuItem::show_all(app, None)?;
                let quit = PredefinedMenuItem::quit(app, None)?;
                let close = PredefinedMenuItem::close_window(app, None)?;

                let undo = PredefinedMenuItem::undo(app, None)?;
                let redo = PredefinedMenuItem::redo(app, None)?;
                let cut = PredefinedMenuItem::cut(app, None)?;
                let copy = PredefinedMenuItem::copy(app, None)?;
                let paste = PredefinedMenuItem::paste(app, None)?;
                let select_all = PredefinedMenuItem::select_all(app, None)?;

                let app_menu = Submenu::with_items(
                    app,
                    "Jimothy",
                    true,
                    &[
                        &about,
                        &sep1,
                        &settings_item,
                        &sep2,
                        &hide,
                        &hide_others,
                        &show_all,
                        &sep3,
                        &quit,
                    ],
                )?;
                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &undo,
                        &redo,
                        &sep4,
                        &cut,
                        &copy,
                        &paste,
                        &select_all,
                    ],
                )?;
                let file_menu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &new_note,
                        &lock_vault,
                        &sep5,
                        &close,
                    ],
                )?;
                return Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu]);
            }
            #[cfg(not(target_os = "macos"))]
            {
                Menu::new(app)
            }
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "about" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("open-about", ());
                    }
                }
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
            commands::pin_enrolled,
            commands::enroll_pin,
            commands::pin_unlock,
            commands::disable_pin,
            commands::pin_verify,
            commands::pin_protection_enrolled,
            commands::pin_unlock_protection,
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
            commands::get_scratchpad_entries,
            commands::append_scratchpad_entry,
            commands::delete_scratchpad_entry,
            commands::get_tasks,
            commands::save_tasks,
            commands::open_folder,
            commands::check_vault_exists,
            commands::list_conflicts,
            commands::resolve_conflict,
            commands::save_image,
            commands::list_emojis,
            commands::import_emoji,
            commands::delete_emoji,
            commands::rename_emoji,
            set_tray_visible,
            open_scratchpad,
            update_global_shortcut,
            update_capture_shortcut,
            update_shortcut,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // System tray
            let quit = MenuItem::with_id(app, "quit", "Quit Jimothy", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Notes", true, None::<&str>)?;
            let new_note =
                MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>)?;
            let scratchpad =
                MenuItem::with_id(app, "scratchpad", "Scratchpad", true, None::<&str>)?;
            let lock = MenuItem::with_id(app, "lock", "Lock Vault", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_note, &scratchpad, &lock, &settings, &quit])?;

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
                    "scratchpad" => {
                        toggle_scratchpad(app);
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

            // Register global shortcuts (load from settings or use defaults)
            let settings = read_shortcut_settings();
            let _ = register_shortcuts_with(&handle, &settings);

            // Decide startup visibility. The window is created hidden
            // (visible:false in tauri.conf.json) and the window-state plugin no
            // longer touches visibility, so this is the single source of truth.
            // The `launchMinimized` setting owns this: when true we leave the
            // window hidden (waiting in the tray); otherwise we show and focus
            // it. When the setting is unset (fresh install or pre-upgrade
            // config) we fall back to the legacy rule of inferring it from
            // autostart. Geometry was already restored by the plugin.
            //
            // Guard: starting hidden only makes sense when the tray icon is
            // shown, otherwise the app would launch with no window AND no tray
            // (recoverable only via the global shortcut). If the tray is off we
            // always show, regardless of launchMinimized.
            //
            // Platform-specific window setup: macOS uses overlay title bar,
            // Windows uses custom title bar with decorations disabled.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_decorations(false);
                }
            }

            let tray_shown = read_bool_setting("showTrayIcon").unwrap_or(true);
            let launch_minimized = tray_shown
                && read_bool_setting("launchMinimized").unwrap_or_else(|| {
                    app.handle().autolaunch().is_enabled().unwrap_or(false)
                });
            if !launch_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Persist geometry while the window is still visible (before we
                // hide it), so size/position survive even if the app is later
                // killed while hidden. Geometry-only — never save visibility, or
                // we'd record visible:false and (were VISIBLE restored) start hidden.
                let _ = window.app_handle().save_window_state(
                    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                );
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
