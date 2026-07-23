# Scratch - Desktop Notes App

A fast, keyboard-first desktop notes app built with Tauri 2, React, TypeScript, and Rust.

## Project Overview

**Stack**: Tauri 2.0, React 19, TypeScript 5.8, Rust (stable), Vite 7
**Platform**: Cross-platform desktop (macOS + Windows)
**Storage**: Local Markdown files with YAML frontmatter, Dropbox-compatible

## Architecture

### Frontend (src/)
- **React 19** with TypeScript
- **Tiptap** WYSIWYG Markdown editor with syntax highlighting, task lists
- **MiniSearch** for full-text search with highlighted results
- **Components**: SearchBar, NotesList, Editor, Settings, CommandPalette, PasswordInput, etc.
- **Hooks**: useNotes, useVault, useProtection, useIdleLock, useUpdater
- **Types**: TypeScript definitions in src/types/

### Backend (src-tauri/)
- **Rust** with Tauri IPC commands
- **Modules**:
  - `commands/` - Tauri IPC interface (CRUD, vault, protection, settings)
  - `crypto/` - XChaCha20-Poly1305 encryption with Argon2id key derivation
  - `notes/` - Note data model (ULID identifiers, serialization)
  - `storage/` - Atomic file writes, conflict detection, trash management, .pnote I/O
  - `watcher/` - Filesystem watcher (notify crate) for external changes
  - `platform/` - OS-specific defaults (shortcuts)
  - `power_events.rs` - macOS sleep/lock detection (IOKit)
  - `lib.rs` - App setup, menu bar, tray, global shortcut, plugins

## Key Features

### Storage
- Plain Markdown files with YAML frontmatter containing metadata (id, title, timestamps, codex, etc.)
- Atomic writes (temp file + rename) prevent partial writes on crash
- ULID identifiers (sortable, unique, embedded in frontmatter)
- Filename sanitization for Windows reserved names, Unicode normalization, invalid characters
- Automatic Dropbox conflict file detection and handling

### Security
Two independent layers of encryption:

**Vault Encryption** (all notes):
- Encrypts ALL notes on disk with a single password
- XChaCha20-Poly1305 with Argon2id key derivation
- Key held only in memory, never persisted
- Auto-locks on system sleep, screen lock, or configurable idle timeout
- Files stored as `.md` (encrypted content)

**File Protection** (individual notes):
- Encrypts individual notes as `.pnote` files
- Metadata (title, timestamps) in cleartext for search/display
- Note body encrypted with separate password
- All protected files share one password
- Can coexist with vault encryption for "extra sensitive" notes

### UI/UX
- Keyboard-first: Cmd+Shift+Space toggles window, Cmd+N new note, Cmd+K command palette
- Codexes: group notes into collections with collapsible sidebar and custom emoji icons
- Pinned notes: star notes to pin at top
- Themes: system, light, or dark
- Command palette (Cmd+K) for quick actions
- Zoom support (Cmd+/- for text size)
- System tray with hide-on-close behavior
- Native macOS menu bar with standard shortcuts

## Development Workflow

### Commands
```bash
npm install              # Install dependencies
npm run tauri dev        # Run dev server with hot reload
npm run typecheck        # TypeScript type checking
npm run test             # Run Vitest test suite
npm run build            # Production build
cargo test --manifest-path src-tauri/Cargo.toml  # Rust tests
```

### Testing
- **Frontend**: Vitest + Testing Library (`*.test.tsx` files)
- **Backend**: `cargo test` in src-tauri/
- **Type safety**: `npm run typecheck` before committing
- **UI changes**: Start dev server (`npm run tauri dev`) and test in the app

### File Structure
```
src/
  components/     React UI components
  hooks/          Custom React hooks for state/side effects
  types/          TypeScript type definitions
  utils/          Utility functions (search, etc.)
  App.tsx         Main app component
  main.tsx        React entry point

src-tauri/
  src/
    commands/     Tauri command handlers (mod.rs contains all commands)
    crypto/       Encryption/decryption logic
    notes/        Note struct and serialization
    storage/      File I/O, atomic writes, trash
    watcher/      Filesystem watcher
    platform/     OS-specific code
    lib.rs        App initialization, menu, tray, plugins
  tauri.conf.json  Tauri configuration (app metadata, bundle settings)
  Cargo.toml      Rust dependencies
```

## Important Design Patterns

### State Management
- AppState in Rust backend holds:
  - `notes_folder`: Path to notes directory
  - `notes`: In-memory cache of all notes
  - `watcher`: Filesystem watcher for external changes
  - `vault_key`, `vault_status`: Vault encryption state
  - `password_hash`: SHA-256 hash for fast password verification
  - `protection_key`, `protection_hash`: File protection state
  - `active_note_id`: Currently edited note
- All state wrapped in `Mutex<T>` for thread safety
- Frontend syncs via Tauri IPC commands and event listeners

### Encryption Flow
- **Vault setup**: Generate Argon2id params → derive key → encrypt all notes → save config
- **Vault unlock**: Load config → derive key with Argon2 → verify key → load all notes
- **Fast password verify**: SHA-256 hash check (cached in memory) avoids expensive Argon2 on every check
- **Protection**: Same crypto as vault, but per-note with separate password

### File Operations
- **Atomic writes**: Write to temp file (`{filename}.tmp.{ulid}`), then rename to final path
- **Conflict detection**: Check for Dropbox conflict files (` (Conflicted Copy)`), emit event
- **Trash**: Move to `{notes_folder}/.scratch/trash/` instead of permanent delete
- **Watcher**: Debounced filesystem events trigger `reload_notes` command

### Optimistic UI
- Title changes update locally before backend save completes
- Frontend assumes success, backend returns updated DTO on completion

## Tauri IPC Commands

All commands defined in `src-tauri/src/commands/mod.rs`:

### Notes
- `set_notes_folder(path)` - Initialize notes folder, load notes
- `get_notes_folder()` - Get current notes folder path
- `get_notes()` - Get all notes (returns Vec<NoteDto>)
- `create_note(title)` - Create new note
- `save_note(id, title, body, codex)` - Save note changes
- `delete_note(id)` - Move note to trash
- `reload_notes()` - Reload all notes from disk
- `restore_from_trash(filename)` - Restore trashed note
- `set_active_note(id)` - Track currently edited note

### Vault Encryption
- `setup_vault(password)` - Initialize vault, encrypt all notes
- `unlock_vault(password)` - Unlock vault and load notes
- `lock_vault()` - Clear key from memory, clear notes
- `get_vault_status()` - Returns "plaintext" | "locked" | "unlocked"
- `verify_password(password)` - Fast password check (SHA-256 or Argon2)
- `change_vault_password(current, new_password)` - Re-encrypt with new password
- `disable_vault(password)` - Decrypt all notes back to plaintext

### File Protection
- `get_protection_status()` - Returns "none" | "locked" | "unlocked"
- `setup_protection(password)` - Initialize protection system
- `unlock_protection(password)` - Unlock protection
- `verify_protection_password(password)` - Fast protection password check
- `protect_note(id)` - Encrypt note as .pnote
- `unprotect_note(id)` - Decrypt .pnote back to .md
- `get_protected_note_body(id)` - Decrypt and return body for viewing
- `save_protected_note(id, title, body, codex)` - Save protected note
- `disable_protection(password)` - Decrypt all .pnote files
- `change_protection_password(current, new_password)` - Re-encrypt protected notes

### Settings
- `get_app_settings()` - Load settings.json from config dir
- `save_app_settings(settings_json)` - Save settings to config dir
- `get_default_notes_path()` - Get default notes path (Dropbox or ~/Scratch)

### System
- `set_tray_visible(visible)` - Show/hide system tray icon

## Configuration Files

### Settings Location
- **macOS**: `~/Library/Application Support/scratch/settings.json`
- **Windows**: `%APPDATA%/scratch/settings.json`

### Notes Folder Structure
```
{notes_folder}/
  *.md                      # Plaintext or vault-encrypted notes
  *.pnote                   # File-protected notes
  .scratch/
    vault.json              # Vault config (Argon2 params, verification record)
    protection.json         # Protection config
    trash/                  # Deleted notes
```

## Keyboard Shortcuts

### Global
- `Cmd+Shift+Space` - Toggle window

### Navigation
- `Cmd+N` - New note
- `Cmd+K` - Command palette
- `Cmd+F` / `Cmd+L` - Focus search
- `Cmd+/` - Toggle codex sidebar
- `Cmd+1` - All notes
- `Cmd+2-9` - Switch codex

### App
- `Cmd+,` - Settings
- `Cmd+=` / `Cmd+-` - Zoom in/out
- `Cmd+0` - Reset zoom
- `Escape` - Close settings / hide window

## Release Process

### Pushing to GitHub
- Do not automatically push to GitHub unless asked to
- Commits should not be co-authored with Claude

### One-time Setup
1. Generate Tauri updater signing keypair: `npx tauri signer generate -w ~/.tauri/scratch.key`
2. Update `src-tauri/tauri.conf.json` with public key and GitHub repo URL
3. Add GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, Apple certificates

### Creating Release
```bash
# 1. Bump version in package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
# 2. Commit and tag
git commit -am "release: v0.2.0"
git tag v0.2.0
git push && git push --tags
# 3. GitHub Actions builds macOS (.dmg) and Windows (.exe) installers
# 4. Review draft release and publish
```

## CI/CD
- Runs on every push/PR to `main`
- TypeScript type checking (`npm run typecheck`)
- Vitest test suite (`npm run test`)
- Rust checks (`cargo check` + `cargo test`) on macOS and Windows

## Code Style & Conventions

### TypeScript
- Functional components with hooks
- TypeScript strict mode enabled
- Prefer named exports over default exports
- Test files: `*.test.tsx` or `*.test.ts`

### Rust
- Follow standard Rust conventions (rustfmt, clippy)
- Use `Result<T, String>` for error handling in commands
- State access via `State<'_, AppState>`
- All mutations behind `Mutex<T>`

### Commits
- No Co-Authored-By trailers (per user preferences)
- Descriptive commit messages focusing on "why" over "what"

## Common Tasks

### Adding a new Tauri command
1. Define function in `src-tauri/src/commands/mod.rs` with `#[tauri::command]`
2. Add to `invoke_handler!` in `src-tauri/src/lib.rs`
3. Call from frontend via `invoke('command_name', { args })`

### Adding a new React hook
1. Create `src/hooks/useMyHook.ts`
2. Export hook function
3. Import and use in components

### Modifying encryption
1. Update `src-tauri/src/crypto/mod.rs`
2. Consider migration path for existing vaults
3. Test with both vault and protection systems

### Adding keyboard shortcuts
1. Global shortcuts: Register in `src-tauri/src/lib.rs` setup
2. App shortcuts: Handle in React components or native menu
3. Document in README.md and Settings keyboard tab

## Troubleshooting

### Build issues
- Ensure Node.js 20+ and Rust stable installed
- Run `npm install` and verify no errors
- Check `src-tauri/target/` for Rust build errors

### Encryption issues
- Verify Argon2 parameters in vault/protection config
- Check that key is in memory (unlocked state)
- Ensure files have correct extensions (.md for plaintext/vault, .pnote for protected)

### File watcher not working
- Check file permissions on notes folder
- Verify watcher initialized in `set_notes_folder`
- Look for errors in `FileWatcher::new`

### Dropbox conflicts
- App auto-detects conflict files, emits `dropbox-conflict` event
- Frontend shows ConflictDialog to resolve
- Never auto-delete conflicts - let user choose

## Testing Strategy

### Unit Tests
- Frontend: Vitest tests in `*.test.tsx` files
- Backend: Rust tests in modules (`#[cfg(test)]` blocks)

### Integration Tests
- Manual testing with dev server running
- Test encryption/decryption flows end-to-end
- Verify file operations (create, save, delete, restore)

### Before Release
1. Run full test suite (`npm run test`, `cargo test`)
2. Type check (`npm run typecheck`)
3. Manual smoke test: create note, encrypt vault, lock/unlock, delete/restore
4. Test on both macOS and Windows
5. Verify updater works with draft release

## Security Considerations

- **Never log passwords or encryption keys**
- Keys held only in memory, cleared on lock
- Use SHA-256 hash for fast password verification (avoid Argon2 on every check)
- Atomic file writes prevent partial data on crash
- Auto-lock on sleep/idle prevents exposure
- Protected notes keep metadata visible for UX while encrypting sensitive content
- Vault password can be reused for protection or use separate password

## License
Private — not yet licensed for distribution.
