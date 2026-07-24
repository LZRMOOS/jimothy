# Agents Configuration for Jimothy

This file provides guidance for AI agents (like Claude) working on the Jimothy codebase.

## Quick Start for Agents

When working on this codebase:
1. Read `.claude/CLAUDE.md` for full architecture and conventions
2. Always run `npm run typecheck` before committing frontend changes
3. Test Rust changes with `cargo test --manifest-path src-tauri/Cargo.toml`
4. For UI changes, start dev server (`npm run tauri dev`) and test the feature manually

## Project Context

**What is Jimothy?**
A keyboard-first desktop notes app with local Markdown storage, internal note linking, dictionary mentions, inline tags, task management (priority/due dates), text macros, scratchpad quick-capture, split view, backlinks, daily notes, optional encryption (vault + per-note protection), and Dropbox sync compatibility. Built with Tauri 2, React 19, and Rust.

**Tech Stack:**
- Frontend: React 19, TypeScript 5.8, Tiptap editor (with custom extensions), tiptap-markdown, MiniSearch, Vite 7
- Backend: Rust with Tauri 2.0, XChaCha20-Poly1305 crypto, Argon2id KDF
- Platform: macOS + Windows desktop
- Current version: 0.4.0

## Common Agent Tasks

### 1. Frontend Changes (React/TypeScript)

**Before starting:**
- Check `src/components/` and `src/hooks/` for existing patterns
- Review `src/types/index.ts` for type definitions
- Look at similar components for reference (e.g., PasswordInput is reused across auth flows)

**Workflow:**
1. Make changes to `.tsx` or `.ts` files
2. Run `npm run typecheck` to verify no type errors
3. If adding tests, put them in `*.test.tsx` files
4. Run `npm run test` for Vitest suite
5. Start dev server and manually test the feature

**Common patterns:**
- Use hooks from `src/hooks/` for state management (useNotes, useVault, useProtection, etc.)
- Tauri IPC: `import { invoke } from '@tauri-apps/api/core'` then `invoke('command_name', { args })`
- Event listeners: `import { listen } from '@tauri-apps/api/event'`
- Optimistic UI: Update local state immediately, backend confirms async

**Files to check:**
- `src/App.tsx` - Main app layout, state, keyboard handlers, command palette actions, split view, daily note
- `src/components/Settings.tsx` - Settings modal with tabs (General, Organization, Controls, Macros, Dictionary, Colors, Storage, Security, Markdown)
- `src/components/Editor.tsx` - Tiptap editor integration (note links, mentions, tags, find & replace, macros, table of contents)
- `src/extensions/noteLink.tsx` - Internal note link extension (`[[` autocomplete)
- `src/extensions/mention.tsx` - Dictionary `@` mention extension
- `src/extensions/tagHighlight.ts` - Inline `#tag` highlighting with custom colors
- `src/extensions/taskPriority.ts` - Task priority pills (!high, !med, !low)
- `src/extensions/taskDueDate.ts` - Task due date pills (!YYYY-MM-DD)
- `src/components/ReferencePanel.tsx` - Tabbed reference panel (Markdown + Controls)
- `src/components/CommandPalette.tsx` - Cmd+K quick actions with pinnable favorites and note search
- `src/components/NotesList.tsx` - Note list with search, backlinks, context menu (delete, pin, archive, freeze, duplicate)
- `src/components/Scratchpad.tsx` - Floating quick-capture window

### 2. Backend Changes (Rust/Tauri)

**Before starting:**
- Review `src-tauri/src/commands/mod.rs` for existing commands
- Check `src-tauri/src/lib.rs` for app setup, menu, tray, global shortcuts
- Look at module structure: crypto, notes, storage, watcher, platform

**Workflow:**
1. Add/modify code in `src-tauri/src/`
2. For new Tauri commands:
   - Add `#[tauri::command]` function to `src-tauri/src/commands/mod.rs`
   - Register in `invoke_handler!` in `src-tauri/src/lib.rs`
3. Run `cargo check` to verify compilation
4. Run `cargo test --manifest-path src-tauri/Cargo.toml`
5. Test via frontend integration

**State management:**
- `AppState` in `commands/mod.rs` holds all shared state
- All fields wrapped in `Mutex<T>` for thread safety
- Access via `state: State<'_, AppState>` parameter
- Use `.lock().unwrap()` to access mutex contents

**Common modules:**
- `commands/` - All Tauri IPC command handlers (CRUD, vault, protection, settings, scratchpad)
- `crypto/` - Argon2id key derivation, XChaCha20-Poly1305 encryption
- `storage/` - Atomic file writes, note loading, .pnote handling, trash
- `notes/` - Note struct with ULID id, serialization to/from Markdown + frontmatter (includes `archived` field)
- `watcher/` - Filesystem watcher for external file changes
- `lib.rs` - App setup, menu, tray, global shortcuts, scratchpad window, autostart plugin

### 3. Adding New Features

**Planning:**
1. Determine if it's frontend, backend, or both
2. Check if existing infrastructure can be reused (e.g., PasswordInput component, crypto module, Tiptap extensions)
3. Consider state management (AppState on backend, React hooks on frontend)
4. Plan keyboard shortcuts if applicable
5. Check if it should appear in the command palette (Cmd+K)

**Implementation order:**
1. Backend: Add Tauri commands and necessary storage/crypto logic
2. Frontend: Create/modify components, hooks, or Tiptap extensions
3. Integration: Connect frontend to backend via IPC
4. Testing: Unit tests + manual integration testing
5. Documentation: Update README.md and CLAUDE.md if it's a user-facing feature
6. Add to command palette if it's a user action

**Example: Adding a new note field**
1. Update `Note` struct in `src-tauri/src/notes/mod.rs`
2. Update serialization in `storage/mod.rs` (frontmatter parsing)
3. Update `NoteDto` in `src-tauri/src/commands/mod.rs`
4. Update TypeScript `Note` type in `src/types/index.ts`
5. Update UI in `src/components/Editor.tsx` or wherever displayed
6. If it's a per-note preference (like pinned/frozen), add to `Preferences` type and manage in App.tsx
7. Test create, save, load, encrypted vault, and protected note flows

### 4. Encryption/Security Changes

**Critical considerations:**
- Never log passwords, keys, or encrypted content
- Keys must stay in memory only (never persist to disk)
- Use Argon2id for key derivation (expensive, but that's the point)
- Use SHA-256 hash for fast password verification in UX flows
- Atomic file writes prevent data corruption on crash
- Vault and protection are independent systems (can coexist)

**Testing encryption changes:**
1. Test vault setup → lock → unlock → change password → disable
2. Test protection setup → protect note → unlock → view → unprotect → change password → disable
3. Test vault + protection together (re-auth flow for sensitive notes)
4. Verify key clearing on lock, sleep, idle timeout
5. Check file formats: `.md` for plaintext/vault, `.pnote` for protected

**Files to modify:**
- `src-tauri/src/crypto/mod.rs` - Core crypto primitives
- `src-tauri/src/commands/mod.rs` - Vault and protection commands
- `src-tauri/src/storage/mod.rs` - Encrypted file I/O
- Frontend hooks: `src/hooks/useVault.ts`, `src/hooks/useProtection.ts`

### 5. UI/UX Improvements

**Before changing UI:**
- Start dev server: `npm run tauri dev`
- Test in both light and dark themes (colors are customizable per theme)
- Verify keyboard shortcuts still work
- Check responsiveness (window resize to minimum dimensions)

**UI components structure:**
- `SearchBar.tsx` - Search input at top (Cmd+Shift+F) with #tag and @mention filtering
- `NotesList.tsx` - Sidebar with note list, codex filtering, pinned notes, backlink expansion, context menu
- `Editor.tsx` - Tiptap WYSIWYG editor with note links, mentions, tags, find & replace, macros, table of contents, freeze
- `ReferencePanel.tsx` - Tabbed reference panel (Cmd+.) with Markdown and Controls tabs
- `Settings.tsx` - Modal with tabs (General, Organization, Controls, Macros, Dictionary, Colors, Storage, Security, Markdown)
- `CommandPalette.tsx` - Cmd+K quick actions with pinnable favorites and note search
- `Scratchpad.tsx` - Floating quick-capture window with entries list
- `FolderSetup.tsx` - Welcome/setup screen with sync folder hints
- `PasswordInput.tsx` - Reusable password input with show/hide toggle

**CSS/Styling:**
- Main styles in `src/styles.css` with CSS custom properties for theming
- Light and dark themes with user-customizable accent/background colors, color presets
- Custom codex colors and tag colors
- Tauri titlebar style set to "Overlay" with hidden title
- System tray icon and native menu bar on macOS

### 6. File Operations & Storage

**Storage model:**
- Notes are Markdown files with YAML frontmatter
- Frontmatter contains: id (ULID), title, created_at, updated_at, codex, archived, etc.
- Body is plain Markdown text
- Per-note state (pinned, frozen, protected) stored in preferences.json, not in the note file

**File naming:**
- Sanitize title for filename (handle spaces, special chars, Windows reserved names)
- Encrypted vault: `{sanitized-title}.md` (content encrypted)
- Protected notes: `{sanitized-title}.pnote` (frontmatter plaintext, body encrypted)

**Atomic writes pattern:**
1. Write to temporary file: `{filename}.tmp.{ulid}`
2. Rename temp file to final filename (atomic operation)
3. This prevents partial writes if app crashes during save

**Dropbox conflict handling:**
- Detect files matching `*conflicted copy*` pattern
- Emit `dropbox-conflict` event to frontend
- Frontend shows `ConflictDialog` for user resolution
- Never auto-delete conflicts

**Trash system:**
- Delete moves files to `{notes_folder}/.scratch/trash/`
- Restore from trash via `restore_from_trash` command
- Trash files keep original filenames for easy identification

### 7. Testing Strategy

**Type checking (required before commits):**
```bash
npm run typecheck
```

**Frontend tests:**
```bash
npm run test              # Run once
npm run test:watch        # Watch mode
```

**Backend tests:**
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

**Integration testing:**
1. Start dev server: `npm run tauri dev`
2. Test the feature manually in the app
3. Try edge cases (empty notes, special characters, long titles, etc.)
4. Test both light and dark themes
5. Test keyboard shortcuts
6. Test with vault locked/unlocked
7. Test with protected notes

**Critical test scenarios:**
- Create note → save → reload app → note persists
- Encrypt vault → lock → unlock → notes still readable
- Protect note → lock app → unlock → need re-auth to view note
- Delete note → check trash folder → restore from trash
- Archive note → verify hidden from main list → unarchive
- Freeze note → verify editor is read-only → unfreeze
- External file change → watcher detects → notes reload
- Dropbox conflict file appears → conflict dialog shown
- Scratchpad entries → persist across app restart
- Daily note → creates with correct format and codex

### 8. Debugging Tips

**Frontend debugging:**
- Open DevTools in Tauri window (right-click → Inspect Element)
- Console logs appear in DevTools
- Check Network tab for Tauri IPC calls (they appear as internal requests)

**Backend debugging:**
- Rust println! statements appear in terminal running `npm run tauri dev`
- Use `eprintln!` for stderr output
- Check `Result<T, String>` error messages returned to frontend
- Enable Rust backtrace: `RUST_BACKTRACE=1 npm run tauri dev`

**Common issues:**
- "No notes folder set" → Must call `set_notes_folder` on app start
- "Vault is locked" → Must unlock vault before note operations
- "Protection not unlocked" → Must unlock protection before viewing protected notes
- File watcher not triggering → Check file permissions, verify watcher initialized
- Type errors → Run `npm run typecheck` to see detailed error locations

### 9. Performance Considerations

**Frontend:**
- Search is full-text via MiniSearch (indexed on note load)
- Debounce search input to avoid re-searching on every keystroke
- Virtual scrolling not implemented (assume reasonable note count <10k)

**Backend:**
- Notes cached in `AppState.notes` (avoid disk reads on every list refresh)
- File watcher triggers reload on external changes
- Argon2 is intentionally slow (security), use SHA-256 hash for fast re-checks
- Atomic writes prevent corruption but may be slow for very large notes

**Optimization opportunities:**
- Lazy-load note bodies (currently all loaded on vault unlock)
- Index only visible note fields for search (not full body)
- Debounce file watcher events (multiple rapid changes)

### 10. Release Checklist for Agents

When preparing a release:
1. Bump version in three places: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
2. Run full test suite: `npm run typecheck`, `npm run test`, `cargo test`
3. Test dev build: `npm run tauri dev` → smoke test features
4. Commit: `git commit -am "release: vX.Y.Z"`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push && git push --tags`
7. GitHub Actions will build macOS (.dmg) and Windows (.exe) installers
8. Review draft release, then publish

**Don't forget:**
- Update README.md if features changed
- Check that updater public key is set in `tauri.conf.json`
- Verify GitHub secrets are configured (signing keys, Apple certificates)

## Code Patterns to Follow

### TypeScript
```typescript
// Tauri IPC command call
import { invoke } from '@tauri-apps/api/core';

const result = await invoke<NoteDto>('create_note', { title: 'My Note' });

// Event listener
import { listen } from '@tauri-apps/api/event';

listen('dropbox-conflict', () => {
  // Handle conflict
});
```

### Rust Tauri Command
```rust
#[tauri::command]
pub fn my_command(
    arg: String,
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<MyDto, String> {
    let folder = state.folder()?;
    // ... logic here
    Ok(MyDto { /* ... */ })
}
```

### Atomic File Write
```rust
use std::fs;
use std::path::Path;

// Write to temp file
let temp_path = path.with_extension("tmp");
fs::write(&temp_path, content)?;

// Atomic rename
fs::rename(&temp_path, &path)?;
```

### React Hook Usage
```typescript
import { useNotes } from './hooks/useNotes';

function MyComponent() {
  const { notes, createNote, saveNote, deleteNote } = useNotes();
  
  // ... component logic
}
```

## Anti-Patterns to Avoid

❌ **Don't:**
- Persist encryption keys to disk (always in-memory only)
- Log passwords, keys, or encrypted content
- Skip type checking before committing
- Modify files without atomic writes
- Auto-delete Dropbox conflict files
- Add Co-Authored-By trailers to commits (user preference)
- Guess at encryption details (always follow existing crypto patterns)
- Skip manual UI testing for UI changes
- Change the `scratch://` URI scheme in note links (kept for backwards compatibility)
- Change the `.scratch/` internal directory name (kept for backwards compatibility)
- Store per-note state (pinned, frozen) in the note file itself (use preferences.json)

✅ **Do:**
- Run `npm run typecheck` before committing
- Test encryption changes thoroughly (vault + protection + combination)
- Use existing components (PasswordInput, etc.) for consistency
- Follow atomic write pattern for file operations
- Clear keys from memory on lock
- Emit events for async notifications (file changes, conflicts, etc.)
- Check both light and dark themes for UI changes
- Use custom DOM events for cross-component communication (e.g., `open-in-note-search`, `open-find-replace`, `toggle-toc`)
- Use `useEffect` for focus management rather than setTimeout hacks
- Add new user-facing features to the command palette where appropriate

## File Organization

```
.claude/
  CLAUDE.md           # Main documentation (this is the source of truth)
  agents/
    AGENTS.md         # This file - agent-specific guidance

src/
  components/         # React components (*.tsx)
  extensions/         # Tiptap editor extensions (noteLink, mention, tagHighlight, taskPriority, taskDueDate)
  hooks/              # React hooks (*.ts)
  types/              # TypeScript types (index.ts)
  utils/              # Utilities (search.ts, etc.)
  App.tsx             # Main app
  main.tsx            # Entry point
  styles.css          # Global styles, CSS custom properties for themes

src-tauri/
  src/
    commands/
      mod.rs          # All Tauri IPC commands (notes, vault, protection, settings, scratchpad)
    crypto/
      mod.rs          # Encryption/decryption
    notes/
      mod.rs          # Note data model
    storage/
      mod.rs          # File I/O, atomic writes
    watcher/
      mod.rs          # Filesystem watcher
    platform/
      mod.rs          # OS-specific code
      macos.rs
      windows.rs
    power_events.rs   # macOS sleep/lock detection
    lib.rs            # App setup, menu, tray, scratchpad window, autostart
    main.rs           # Entry point
  tauri.conf.json     # Tauri config
  Cargo.toml          # Rust dependencies
```

## Key Feature Implementation Notes

### Internal Note Links
- Extension: `src/extensions/noteLink.tsx`
- Uses `@tiptap/suggestion` for `[[` autocomplete trigger
- Links stored as standard markdown: `[Title](scratch://id)` (the `scratch://` URI is kept for backwards compat)
- Title resolution via `notesRef` closure at parse and serialize time (rename-proof)
- `ReactRenderer` from `@tiptap/react` renders suggestion popup
- Popup uses `positionPopup()` to flip above cursor when near viewport bottom
- Click navigation checks `event.target.closest('.note-link')` to avoid false triggers
- Shows codex pill in autocomplete dropdown

### Dictionary Mentions
- Extension: `src/extensions/mention.tsx`
- Uses `@tiptap/suggestion` for `@` autocomplete trigger
- Renders as `<span data-type="mention">` with `.mention` class
- Also decorates existing `@word` patterns that match the dictionary
- Dictionary list managed in Settings > Dictionary tab

### Inline Tags
- Extension: `src/extensions/tagHighlight.ts`
- Decorates `#tag` patterns inline with configurable colors
- Tags are filterable in the search bar (type `#tag` to filter notes)
- Tag colors managed in Settings > Organization tab

### Task Priority & Due Date
- Extensions: `src/extensions/taskPriority.ts` and `src/extensions/taskDueDate.ts`
- Render colored pills inside task list items
- Priority: `!high` (red), `!med` (orange), `!low` (green)
- Due date: `!YYYY-MM-DD` with color shift (green→orange→red as deadline approaches)

### Scratchpad
- Separate Tauri window (not the main app window)
- Toggled with global shortcut (default Cmd+Option+Space, customizable)
- Entries stored in `.scratch/scratchpad.json`
- Quick text input with Cmd+Enter to save, Escape to hide
- Entries can be copied or deleted

### Backlinks
- Built from note link index in App.tsx
- Displayed as expandable children under notes in NotesList
- Keyboard nav: → to expand, ← to collapse, Enter on child to navigate

### Split View
- Cmd+\ toggles a second editor pane showing another note
- Also available via command palette ("Split View") or context menu ("Open in Split")

### Daily Note
- Cmd+J creates or opens today's daily note
- Configurable title format (default: `{date}`) and codex assignment
- Settings in Organization tab: `dailyNoteFormat` and `dailyNoteCodex`

### Reference Panel
- Component: `src/components/ReferencePanel.tsx`
- Single panel with two tabs: Markdown and Controls
- Toggled with Cmd+. (boolean show/hide state)
- Positioned as 240px side panel within main-content flex container
- Content mirrors what's in Settings Markdown and Controls tabs

### Text Macros
- Built-in: /date, /time (expand to current date/time)
- Custom user-defined macros stored in preferences
- Implemented in Editor.tsx as Tiptap input rules

### Color Customization
- Users can override accent and background colors per theme
- Color presets: save and load named color configurations
- Custom codex colors (sidebar color per codex)
- Custom tag colors (inline tag highlight colors)
- ColorSettings component derives light/dark from `settings.theme` + `matchMedia`
- CSS custom properties updated dynamically

### Settings Architecture
- **Local settings** (`settings.json` in app config dir): device-specific (notesFolder, showTrayIcon, zoomLevel, shortcuts)
- **Preferences** (`preferences.json` in .scratch/): portable, synced across devices (theme, macros, codex icons, colors, pinned/frozen lists, etc.)
- Frontend merges both into a single `AppSettings` object for convenience

## Questions to Ask

When stuck or unsure:
1. Does a similar feature already exist? Check related components/commands
2. Does this need backend (Rust) changes or just frontend?
3. Will this affect encrypted vaults or protected notes? Test both
4. Are there keyboard shortcuts? Document them
5. Does this change file format? Consider migration for existing users
6. Is this a breaking change? Bump version accordingly
7. Did you test in both light and dark themes?
8. Did you run type checking and tests?

## Resources

- [Tauri Docs](https://tauri.app/v2/)
- [React Docs](https://react.dev/)
- [Tiptap Docs](https://tiptap.dev/)
- [Argon2 Spec](https://datatracker.ietf.org/doc/rfc9106/)
- [XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)

## Contact

For questions about architecture decisions or unclear patterns, refer to the git history or commit messages for context on why things were done a certain way.
