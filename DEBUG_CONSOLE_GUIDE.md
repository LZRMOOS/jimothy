# Debug Console Guide

## How to Use

1. Open Settings (Cmd+, or gear icon)
2. Go to "General" → "About" tab
3. Click "Show Console" button under the "Debug" section
4. The debug console will appear at the bottom of the screen

## What It Shows

The debug console intercepts and displays all:
- `console.log()` - Regular logs in gray
- `console.warn()` - Warnings in orange
- `console.error()` - Errors in red

Each entry shows:
- Timestamp (HH:MM:SS)
- Log level ([LOG], [WARN], [ERROR])
- Message content

## Window Controls Debugging

With the detailed logging added to WindowControls.tsx, you'll see:

### When clicking Minimize:
```
[WindowControls] 🔽 Minimize button clicked
[WindowControls] Got window object: [object]
[WindowControls] ✓ Minimize succeeded
```

### When clicking Maximize:
```
[WindowControls] ⬜ Maximize button clicked
[WindowControls] Got window object: [object]
[WindowControls] Current maximized state: false
[WindowControls] ✓ Maximize toggle succeeded
```

### When clicking Close:
```
[WindowControls] ❌ Close button clicked
[WindowControls] Got window object: [object]
[WindowControls] ✓ Close succeeded (window should hide/close now)
```

## Troubleshooting Button Clicks

If you **don't see ANY logs** when clicking the buttons:
- The onClick handlers are not firing
- This means a CSS/pointer-events issue is blocking clicks
- Check the CSS fixes we applied (z-index, pointer-events: auto !important)

If you **see the logs but buttons don't work**:
- The handlers ARE firing
- The Tauri API calls are failing
- Check for error messages in the console
- The close button will show logs but window just hides (expected behavior with tray)

## Features

- Auto-scrolls to latest log
- "Clear" button to reset logs
- Keeps last 100 log entries
- Dismissable with "×" button
- Styled to match app theme

## Files Changed

- `src/components/DebugConsole.tsx` - New debug console component
- `src/components/WindowControls.tsx` - Added detailed logging
- `src/components/Settings.tsx` - Added "Show Console" button
- `src/App.tsx` - Integrated debug console
- `src/styles.css` - Debug console styling

## CSS Fixes Applied

```css
.window-controls {
  pointer-events: auto !important;
  z-index: 100;
}

.window-control-btn {
  -webkit-app-region: no-drag;
  pointer-events: auto !important;
}
```

These ensure the buttons are clickable and not blocked by the drag region.
