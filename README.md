# Jimothy

A fast, keyboard-first desktop notes app. Cross-platform (macOS + Windows), Dropbox-compatible, locally-stored, with optional encryption.

Built with Tauri 2, React, TypeScript, and Rust.

## Features

- **Keyboard-first** — global shortcut (Cmd+Shift+Space) toggles the window, Cmd+N new note, Cmd+K command palette
- **Instant search** — full-text search via MiniSearch with highlighted results in the editor
- **WYSIWYG Markdown** — Tiptap editor with syntax highlighting, task lists, code blocks, and word/char count
- **Internal note links** — type @ to link to other notes with autocomplete; links survive title renames
- **Codexes** — group notes into collections with a collapsible icon sidebar and custom emoji icons
- **Pinned notes** — star notes to pin them at the top of the list
- **Text macros** — /date, /time, and custom macros that expand as you type
- **Local storage** — plain Markdown files with YAML frontmatter, compatible with any sync service
- **Dropbox sync** — detects and handles Dropbox conflict files automatically
- **Vault encryption** — XChaCha20-Poly1305 with Argon2id key derivation; encrypts all notes, locks on sleep/idle/manually
- **File protection** — encrypt individual notes as `.pnote` files with a separate password; can coexist with vault encryption
- **Auto-updates** — built-in updater checks for new releases
- **System tray** — hide-on-close, tray menu for quick actions
- **Native menu bar** — macOS app menu with standard keyboard shortcuts
- **Command palette** — Cmd+K for quick actions (search, pin, protect, copy as markdown, etc.)
- **Reference panels** — Cmd+. for markdown reference, Cmd+; for keyboard shortcuts
- **Zoom** — Cmd+/- to adjust text size
- **Themes** — system, light, or dark with customizable colors
- **In-note search** — Cmd+F to find within the current note with match cycling

## Security Model

Jimothy offers two layers of encryption that can be used independently or together:

### Vault Encryption

Encrypts **all** notes on disk with a single password. When locked, every note file is unreadable. The key is derived via Argon2id and held only in memory — never persisted to disk. The vault automatically locks on system sleep, screen lock, or after a configurable idle timeout.

### File Protection

Encrypts **individual** notes while keeping the rest as plaintext Markdown. Protected notes are stored as `.pnote` files — the note body is encrypted while metadata (title, timestamps) remains in the clear for search and display. All protected files share a single password.

### Using Both Together

When vault encryption is enabled, file protection acts as an additional re-authentication gate for sensitive notes. The vault password encrypts everything on disk, and notes marked as "protected" require re-entering the vault password before viewing (with a 5-minute grace period). This is useful for extra-sensitive notes within an already-encrypted vault.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) stable toolchain
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools with C++ workload

### Setup

```sh
git clone <repo-url> && cd jimothy
npm install
```

### Run

```sh
npm run tauri dev
```

### Test

```sh
npm run typecheck          # TypeScript
npm run test               # Vitest
cargo test --manifest-path src-tauri/Cargo.toml   # Rust
```

## Architecture

```
src/                    React frontend
  components/           SearchBar, NotesList, Editor, Settings, CommandPalette, ReferencePanel, etc.
  extensions/           Tiptap editor extensions (note links)
  hooks/                useNotes, useVault, useProtection, useIdleLock, useUpdater
  types/                TypeScript type definitions
  utils/                Utility functions (search)

src-tauri/              Rust backend
  src/
    commands/           Tauri IPC commands (CRUD, vault, protection, settings)
    crypto/             Argon2id + XChaCha20-Poly1305 encryption
    notes/              Note data model and serialization
    storage/            Atomic file writes, conflict detection, trash, .pnote I/O
    watcher/            Filesystem watcher (notify crate)
    platform/           OS-specific defaults (shortcuts)
    power_events.rs     macOS sleep/lock detection (IOKit)
    lib.rs              App setup, menu bar, tray, global shortcut, plugins
```

### Key design decisions

- **Atomic writes** — temp file + rename prevents partial writes on crash
- **ULID identifiers** — sortable, unique, embedded in frontmatter
- **Filename sanitization** — handles Windows reserved names, Unicode normalization, invalid characters
- **Vault key in memory only** — never persisted; cleared on lock/sleep/idle timeout
- **Optimistic UI** — title changes update locally before backend save completes
- **ID-based note links** — `[Title](scratch://id)` format survives renames and is valid markdown

## Settings

Accessible via Cmd+, or the command palette. Tabs:

| Tab | Options |
|-----|---------|
| General | Auto-updates, confirm before delete, launch at login, menu bar icon |
| Controls | Full shortcut reference (global, search, notes, view, app) |
| Macros | Built-in (/date, /time) and custom text expansion macros |
| Colors | Theme (system/light/dark), custom color overrides per theme |
| Storage | Notes folder path, change folder, open in Finder, rebuild index |
| Security | Vault encryption, auto-lock timeout, file protection, change password |
| Markdown | Syntax reference for formatting, code blocks, lists, links, note links |

Settings stored at `~/Library/Application Support/jimothy/settings.json` (macOS) or `%APPDATA%/jimothy/settings.json` (Windows).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+Space | Toggle window |
| Cmd+N | New note |
| Cmd+K | Command palette |
| Cmd+F | Find in note |
| Cmd+Shift+F / Cmd+L | Search notes |
| Cmd+/ | Toggle codex sidebar |
| Cmd+1 | All notes |
| Cmd+2–9 | Switch codex |
| Cmd+Shift+] / [ | Next/previous note |
| Cmd+, | Settings |
| Cmd+. | Markdown reference panel |
| Cmd+; | Controls reference panel |
| Cmd+= / Cmd+- | Zoom in/out |
| Cmd+0 | Reset zoom |
| Escape | Close panel / hide window |

## Releasing

### One-time setup

1. Generate a Tauri updater signing keypair:

   ```sh
   npx tauri signer generate -w ~/.tauri/jimothy.key
   ```

2. Update `src-tauri/tauri.conf.json` — set `plugins.updater.endpoints` to your GitHub repo URL:

   ```json
   "endpoints": ["https://github.com/LZRMOOS/jimothy/releases/latest/download/latest.json"]
   ```

3. Set `plugins.updater.pubkey` to the public key from step 1.

4. Add GitHub repository secrets:

   | Secret | Purpose |
   |--------|---------|
   | `TAURI_SIGNING_PRIVATE_KEY` | Updater signing key (contents of `~/.tauri/jimothy.key`) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key |
   | `APPLE_CERTIFICATE` | Base64-encoded .p12 certificate |
   | `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
   | `APPLE_SIGNING_IDENTITY` | e.g. "Developer ID Application: Your Name (TEAM_ID)" |
   | `APPLE_ID` | Apple ID email for notarization |
   | `APPLE_PASSWORD` | App-specific password |
   | `APPLE_TEAM_ID` | Apple Developer team ID |

### Creating a release

```sh
# Bump version in package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml
git commit -am "release: v0.2.0"
git tag v0.2.0
git push && git push --tags
```

The release workflow builds:
- **macOS**: `.dmg` for arm64 and x64
- **Windows**: NSIS installer (`.exe`)

Artifacts are attached to a draft GitHub Release. Review and publish when ready.

## CI

Runs on every push/PR to `main`:
- TypeScript type checking
- Vitest test suite
- `cargo check` + `cargo test` on macOS and Windows

## License

Private — not yet licensed for distribution.
