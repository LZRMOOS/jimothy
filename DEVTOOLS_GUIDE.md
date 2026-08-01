# DevTools Guide

## How to Open DevTools

### In Development Mode
1. Open Settings → General → About
2. Click "Open DevTools" button
3. Or press F12 / Cmd+Option+I
4. Or right-click → Inspect Element

### In Production Build
The "Open DevTools" button will show instructions since DevTools aren't programmatically accessible in production:

**Windows:**
- Press **F12**
- Or right-click anywhere → **Inspect Element**

**macOS:**  
- Press **Cmd+Option+I**
- Or right-click anywhere → **Inspect Element**

## What You'll See

With DevTools open, the Console tab will show detailed logs from WindowControls:

### Minimize Button
```
[WindowControls] 🔽 Minimize button clicked
[WindowControls] Got window object: [object]
[WindowControls] ✓ Minimize succeeded
```

### Maximize Button
```
[WindowControls] ⬜ Maximize button clicked
[WindowControls] Got window object: [object]
[WindowControls] Current maximized state: false
[WindowControls] ✓ Maximize toggle succeeded
```

### Close Button
```
[WindowControls] ❌ Close button clicked
[WindowControls] Got window object: [object]
[WindowControls] ✓ Close succeeded (window should hide/close now)
```

## Diagnosing Button Issues

### No Logs Appear
**Problem:** Buttons aren't receiving click events  
**Cause:** CSS/pointer-events issue  
**Check:** 
- Inspect the `.window-controls` element
- Verify `pointer-events: auto !important`
- Verify `z-index: 100`

### Logs Appear But Nothing Happens
**Problem:** Tauri API calls failing  
**Cause:** API error or permission issue  
**Check:**
- Look for error messages in console
- Check if window object is valid

### Success Logs But Unexpected Behavior
**Problem:** Buttons work, behavior is intentional  
**Example:** Close button hides to tray instead of quitting
- This is expected when tray icon is enabled
- To quit: Right-click tray → "Quit"

## Cross-Platform Notes

✅ **DevTools work on both Windows and macOS**
- Same keyboard shortcuts
- Same right-click menu
- Same console output

✅ **Logging works in both dev and production**
- All `console.log/warn/error` calls appear
- WindowControls logs always visible

⚠️ **Button opening only works in dev mode**
- Production: Use F12 or right-click
- Dev: Button works + keyboard shortcuts work

## Files Changed

- `src-tauri/src/commands/mod.rs` - Added `open_devtools` command
- `src-tauri/src/lib.rs` - Registered command
- `src/components/Settings.tsx` - Added DevTools button with fallback instructions
- `src/components/WindowControls.tsx` - Detailed logging (works in prod!)
