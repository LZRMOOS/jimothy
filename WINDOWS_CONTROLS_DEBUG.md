# Windows Controls Debugging Guide

## Expected Behavior

### With Tray Icon Enabled (default):
- **Minimize button**: Minimizes window to taskbar
- **Maximize button**: Toggles between maximized and windowed
- **Close button**: Hides window to tray (does NOT quit app)
- **To quit**: Right-click tray icon → "Quit"

### With Tray Icon Disabled:
- **Minimize button**: Minimizes window to taskbar  
- **Maximize button**: Toggles between maximized and windowed
- **Close button**: Should quit the app (currently may hide instead - see issue below)

## How to Test on Windows

1. Build the app: `npm run tauri build`
2. Install and run the app
3. Open DevTools: Right-click → Inspect Element
4. Test each button:
   - Click Minimize - check if window minimizes
   - Click Maximize - check if window maximizes/restores
   - Click Close - check console for errors and if window hides

## Known Behavior

The close button triggers `getCurrentWindow().close()` which fires `CloseRequested` event. The Rust backend (`src-tauri/src/lib.rs:459-469`) handles this by:

```rust
if let WindowEvent::CloseRequested { api, .. } = event {
    // Save window state before hiding
    let _ = window.app_handle().save_window_state(
        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
    );
    api.prevent_close();  // Prevent actual close
    let _ = window.hide();  // Hide to tray instead
}
```

This is intentional "hide to tray" behavior - the app doesn't quit when you click X.

## Troubleshooting

### If buttons don't respond to clicks at all:

1. Check if buttons are rendered:
   - Open DevTools
   - Look for `.window-controls` div in the DOM
   - Should see 3 buttons with class `.window-control-btn`

2. Check CSS is applied:
   - Inspect `.window-controls` element
   - Should have `pointer-events: auto`
   - Should have `-webkit-app-region: no-drag`

3. Check z-index:
   - Make sure no overlay is blocking clicks
   - Parent `.search-bar-inner` has `pointer-events: none` but children should have `auto`

### If buttons respond but don't work correctly:

1. Check console for errors
2. Verify Tauri API is available: `window.__TAURI__`
3. Check if getCurrentWindow() returns valid window object

### If close button doesn't quit when tray is disabled:

The Rust backend needs to be updated to check tray status before preventing close:

```rust
// In src-tauri/src/lib.rs, around line 459
if let WindowEvent::CloseRequested { api, .. } = event {
    // Check if tray is shown
    let state = window.state::<AppState>();
    let show_tray = state.show_tray_icon.lock();
    
    if *show_tray {
        // Hide to tray
        let _ = window.app_handle().save_window_state(...);
        api.prevent_close();
        let _ = window.hide();
    } else {
        // Actually quit
        // Don't call prevent_close(), let it close
    }
}
```

## Implementation Details

### Frontend (`src/components/WindowControls.tsx`):
- Only renders on Windows (`if (isMac) return null`)
- Calls Tauri window APIs:
  - `getCurrentWindow().minimize()`
  - `getCurrentWindow().toggleMaximize()`
  - `getCurrentWindow().close()`

### Backend (`src-tauri/src/lib.rs`):
- Line 438-441: Sets up Windows-specific window (decorations off, hidden title)
- Line 458-470: Handles close requests (prevents and hides to tray)

### Styling (`src/styles.css`):
- Line 481-519: Window controls styling
- Important: `pointer-events: auto` and `-webkit-app-region: no-drag`
