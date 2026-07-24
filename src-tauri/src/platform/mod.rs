#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

pub fn default_shortcut() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Command+Shift+Space"
    }
    #[cfg(target_os = "windows")]
    {
        "Control+Shift+Space"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Control+Shift+Space"
    }
}

pub fn default_capture_shortcut() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Command+Alt+Space"
    }
    #[cfg(target_os = "windows")]
    {
        "Control+Alt+Space"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Control+Alt+Space"
    }
}
