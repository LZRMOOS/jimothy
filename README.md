# Scratch

A fast, keyboard-first desktop notes app. Cross-platform (macOS + Windows), Dropbox-compatible, locally-stored, with optional encryption.

Built with Tauri 2, React, TypeScript, and Rust.

## Features

- **Keyboard-first** — global shortcut (Cmd+Shift+Space) toggles the window, Cmd+N new note, Cmd+L/F focus search
- **Instant search** — full-text search via MiniSearch with highlighted results in the editor
- **WYSIWYG Markdown** — Tiptap editor with syntax highlighting, task lists, and word/char count
- **Codexes** — group notes into collections with a collapsible icon sidebar and custom emoji icons
- **Local storage** — plain Markdown files with YAML frontmatter, compatible with any sync service
- **Dropbox sync** — detects and handles Dropbox conflict files automatically
- **Optional encryption** — XChaCha20-Poly1305 with Argon2id key derivation; vault locks on sleep, idle, or manually
- **Auto-updates** — built-in updater checks for new releases
- **System tray** — hide-on-close, tray menu for quick actions
- **Themes** — system, light, or dark

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) stable toolchain
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools with C++ workload

### Setup

```sh
git clone <repo-url> && cd scratch
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
cargo test --manifest-path src-tauri/Cargo.toml   # Rust (32 tests)
```

## Architecture

```
src/                    React frontend
  components/           SearchBar, NotesList, Editor, Settings, Dropdown, etc.
  hooks/                useNotes, useVault, useIdleLock, useUpdater
  types/                TypeScript type definitions

src-tauri/              Rust backend
  src/
    commands/           Tauri IPC commands (CRUD, vault, settings)
    crypto/             Argon2id + XChaCha20-Poly1305 encryption
    notes/              Note data model and serialization
    storage/            Atomic file writes, conflict detection, trash
    watcher/            Filesystem watcher (notify crate)
    platform/           OS-specific defaults (shortcuts)
    power_events.rs     macOS sleep/lock detection (IOKit)
    lib.rs              App setup, tray, global shortcut, plugins
```

### Key design decisions

- **Atomic writes** — temp file + rename prevents partial writes on crash
- **ULID identifiers** — sortable, unique, embedded in frontmatter
- **Filename sanitization** — handles Windows reserved names, Unicode normalization, invalid characters
- **Vault key in memory only** — never persisted; cleared on lock/sleep/idle timeout

## Settings

Accessible via Cmd+, or the gear icon. Tabs:

| Tab | Options |
|-----|---------|
| General | Theme (system/light/dark), confirm before delete, check for updates |
| Keyboard | Full shortcut reference (global, navigation, codex, notes, app) |
| Storage | Notes folder path, change folder, open in Finder, rebuild index |
| Security | Idle lock timeout, enable encryption, lock now, change password |

Settings stored at `~/Library/Application Support/scratch/settings.json` (macOS) or `%APPDATA%/scratch/settings.json` (Windows).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Shift+Space | Toggle window |
| Cmd+N | New note |
| Cmd+F / Cmd+L | Focus search |
| Cmd+/ | Toggle codex sidebar |
| Cmd+1 | All notes |
| Cmd+2–9 | Switch codex |
| Cmd+, | Settings |
| Cmd+Shift+L | Lock vault |
| Cmd+Delete | Delete note |
| Escape | Hide window |

## Releasing

### One-time setup

1. Generate a Tauri updater signing keypair:

   ```sh
   npx tauri signer generate -w ~/.tauri/scratch.key
   ```

2. Update `src-tauri/tauri.conf.json` — set `plugins.updater.endpoints` to your GitHub repo URL:

   ```json
   "endpoints": ["https://github.com/YOUR_USER/scratch/releases/latest/download/latest.json"]
   ```

3. Set `plugins.updater.pubkey` to the public key from step 1.

4. Add GitHub repository secrets:

   | Secret | Purpose |
   |--------|---------|
   | `TAURI_SIGNING_PRIVATE_KEY` | Updater signing key (contents of `~/.tauri/scratch.key`) |
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
