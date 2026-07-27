# Jimothy - Desktop Notes App

A fast, keyboard-first desktop notes app built with Tauri 2, React, TypeScript, and Rust.

## Project Overview

**Stack**: Tauri 2.0, React 19, TypeScript 5.8, Rust (stable), Vite 7
**Platform**: Cross-platform desktop (macOS + Windows)
**Storage**: Local Markdown files with YAML frontmatter, Dropbox-compatible

## Architecture

### Frontend (src/)
- **React 19** with TypeScript
- **Tiptap** WYSIWYG Markdown editor with syntax highlighting, task lists, macros
- **Tiptap extensions**: Note links (`noteLink.tsx`), dictionary mentions (`mention.tsx`), custom emoji (`emoji.tsx`), inline tags (`tagHighlight.ts`), task priority (`taskPriority.ts`), task due date (`taskDueDate.ts`), image paste (`imagePaste.ts`)
- **tiptap-markdown** for Markdown serialization (storage.markdown.serialize/parse)
- **MiniSearch** for full-text search with highlighted results
- **Components**: SearchBar, NotesList, Editor, Settings, CommandPalette, ReferencePanel, Scratchpad, PasswordInput, FolderSetup, etc.
- **Hooks**: useNotes, useVault, useProtection, useIdleLock, useUpdater, useEventListener
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

**Note Protection** (individual notes):
- Encrypts individual notes as `.pnote` files
- Metadata (title, timestamps) in cleartext for search/display
- Note body encrypted with separate password
- All protected files share one password
- Can coexist with vault encryption for "extra sensitive" notes

**PIN Quick-Unlock** (opt-in convenience gate, module `src-tauri/src/pin/mod.rs`):
- A 4-digit PIN is an alternative to a full password. NOT a replacement — the password stays the source of truth and always works. It works with EITHER encryption layer: vault, note protection, or both. Vault encryption is NOT required to set a PIN. Length is fixed at 4 (see `pin::PIN_LENGTH` / `PinInput length`) because it's a convenience gate, not a security boundary; the 10-attempt wipe, not the digit count, is what bounds guessing.
- On enrollment a COPY of whichever in-memory key(s) are unlocked (vault and/or protection) is wrapped with an Argon2id key derived from the PIN and stored in the **app config dir** (`dirs::config_dir()/jimothy/pin-escrow.json`). This is DEVICE-LOCAL and NEVER placed in the notes folder / `.scratch/`, so it never syncs via Dropbox — someone who copies the synced notes gets only the full-strength password vault, no PIN escrow to attack.
- **One PIN, up to two escrows.** The store is keyed by `"{kind}:{vault_path}"` where `kind` is `EscrowKind::Vault | Protection`. `enroll_pin` wraps every key that's in memory at that moment (at least one required, else it errors). If both the vault and note protection are unlocked, the SAME PIN wraps both (separate entries, independent salts). So one PIN both quick-unlocks the vault AND satisfies the sensitive-note re-auth gate — the user's mental model: "if you leave the vault unlocked, the PIN still guards what's sensitive." A layer that isn't unlocked at enroll time isn't covered until the PIN is re-set (enrollment only captures keys in memory at that moment).
- `pin_enrolled` is VAULT-scoped on purpose (the vault UnlockScreen keys off it); `pin_protection_enrolled` reports the protection escrow. Settings combines both. Settings shows a PIN control in the vault-unlocked block AND in the note-protection section (plaintext mode) via the shared `PinControl` component.
- Command layer maps each frontend path to the right escrow: `pin_unlock` (vault, installs key + loads notes), `pin_verify` (vault, re-auth only — verifies against `verification_record` WITHOUT reinstalling, for the vault-mode sensitive-note gate), `pin_unlock_protection` (installs the protection key so `.pnote` bodies decrypt, for the plaintext-mode gate). All three unwrap, then STILL validate against the relevant `verification_record` before use (rejects + deletes a stale escrow after an external re-key).
- Wrong PINs increment a PER-ESCROW failure counter (each escrow tracks its own `fail_count` — this is a deliberate accepted trade-off, not a bug: with both layers enrolled an attacker gets up to `MAX_ATTEMPTS` guesses per escrow, ~19 before either wipes, vs 10 for a truly shared counter; acceptable because the escrow is device-local and the counter is app-enforced only). Reaching `MAX_ATTEMPTS` (10) on ANY escrow wipes BOTH (it's one PIN) and the user must use the password. `record_success` clears both counters after a validated unlock. `disable_pin` removes both (`disable_all`); layer-specific purges use `disable(kind, ...)`: vault escrow on `change_vault_password` / `disable_vault`, protection escrow on `change_protection_password` / `disable_protection`.
- Honest limitation: an attacker with code execution on the unlocked account could read the escrow file and brute-force the PIN offline (the counter is app-enforced only). That attacker can already read the key from process memory, so the PIN isn't the weak link. It's a convenience feature, not a security upgrade. No entitlement / signing / Secure Enclave needed (unlike the parked Touch ID work on `feature/biometric-touch-id-unlock`).

### Editor
- WYSIWYG Markdown editing via Tiptap with syntax highlighting, task lists, code blocks
- **Internal note links**: Type `[[` to trigger autocomplete, links stored as `[Title](scratch://id)` markdown
  - ID-based linking survives note renames (title resolved at parse/serialize time)
  - Autocomplete popup with codex pill, flips above cursor near viewport bottom
  - Click handler checks `.note-link` DOM target to prevent false navigation
  - Displayed with `@` prefix in editor to distinguish from normal links
- **Dictionary mentions**: Type `@` to insert mentions from a user-defined dictionary
- **Custom emoji**: Type `:` to insert custom emoji/icons loaded from a user folder, invoked by filename (`pepe.png` → `:pepe:`); reusable as codex icons
- **Inline tags**: Type `#tag` for searchable, color-coded inline tags
- **Task extensions**: Priority pills (!high, !med, !low) and due date pills (!YYYY-MM-DD) in checkboxes
- **Text macros**: /date, /time, and user-defined custom macros that expand as you type. /table is a special-cased built-in that inserts a real 2×2 table node (not a text expansion) — see `expandMacro` in Editor.tsx.
- **Find & replace**: Cmd+F for find, Cmd+H for find & replace with match cycling (Cmd+] / Cmd+[)
- **Tables**: GFM pipe tables via Tiptap table extensions; stored as portable plain-text Markdown (strictly rectangular, no merged cells or block content in cells). Insert via the "Insert Table" command palette action or the `/table` macro; a floating toolbar (`TableToolbar.tsx`) adds/removes rows and columns and toggles the header row when the cursor is inside a table. Column resizing is display-only (widths not persisted to Markdown).
- **Freeze notes**: Lock a note to prevent accidental edits
- **Copy as plain text**: Copied text strips markdown formatting (transformCopiedText: false)
- Word and character count display

### Tasks Panel (Cross-Platform Feature)
The Tasks panel (`src/components/TasksPanel.tsx`) is a dedicated agenda-style view for managing tasks, toggled with Cmd+T (also accessible from sidebar top icon or command palette "View Tasks").

**On-disk format (shared with jimothy-mobile):**
Tasks live in a single note with codex `"Tasks"` (constant: `TASK_CODEX`). The body is GFM checkbox lines with trailing tokens:
```
- [ ] Call the dentist !high !2026-07-27
- [ ] Meeting with Alex !2026-07-28T09:00
- [x] Buy milk !2026-07-25
- [ ] Something undated
- [ ] Call mom !2026-07-30 !every:1y
- [ ] Team sync !2026-07-28 !every:2w
```
Tokens: `!high`/`!med`/`!low` (priority), `!YYYY-MM-DD` or `!YYYY-MM-DDTHH:MM` (date with optional time), `!every:N[dwmy]` (recurrence). Non-task lines (headings, blanks, prose) are preserved verbatim.

**Recurrence (`!every:Nd/w/m/y`):**
- Units: `d` (day), `w` (week), `m` (month), `y` (year). Always appears after the date token.
- Check-off behavior: do NOT mark done. Advance the date by the interval from the current date value (not from today). The task stays unchecked with its new future date. Recurring tasks never appear in the done list.
- Date advancement: `d` adds N days, `w` adds N*7 days, `m` adds N months (clamp to end-of-month if day overflows, e.g. Jan 31 + 1m = Feb 28), `y` adds N years (clamp for leap day).
- Natural language recognition: "every day/week/month/year", "every N days/weeks/months/years", "every other week", "every monday/weds/fri" (= every 1w, implies next occurrence as start date), "every jul 30/december 25th" (= every 1y, implies next occurrence as start date), plus single-word forms: "daily", "weekly", "monthly", "yearly", "annually", "biweekly", "bimonthly".
- Regex: `/(?:^|\s)(!every:(\d+)([dwmy]))(?=\s|$)/g`

**Cross-platform contract:**
- `jimothy-mobile` (`/Users/weid/src/jimothy-mobile`) reads and writes the SAME note using the same format
- Both apps parse/serialize via line-oriented string ops (no full markdown AST) to guarantee byte-identical round-trips for non-task lines
- Attachments (note links, URLs) are stored inline as standard markdown links: `[label](scratch://id)` for notes, `[label](https://...)` for URLs
- The time extension (`!YYYY-MM-DDTHH:MM`) is a forward-compatible superset; desktop already handles it
- The recurrence extension (`!every:Nd/w/m/y`) follows the same forward-compatible pattern
- Changes to the task line format MUST be coordinated with the mobile codebase to avoid data loss or parse failures on sync

**Key files:**
- `src/utils/taskList.ts` - Parse/serialize task doc, `TASK_CODEX` constant
- `src/utils/agenda.ts` - Build agenda sections (active/done) from tasks
- `src/utils/naturalDate.ts` - Natural language date/time recognition for task input
- `src/components/TasksPanel.tsx` - Full panel UI (agenda view, add/edit modal, drag-and-drop)

**UI behavior:**
- Task notes are hidden from the regular notes list, search bar, and command palette note search
- The Tasks codex does not appear in the codex sidebar list
- "View Tasks" command and Cmd+T are the entry points
- Add modal supports natural date/time/recurrence parsing ("tomorrow 9am", "every 2 weeks"), `[[` note link autocomplete, `@` dictionary mentions, and URL auto-detection
- Done tab uses compact table-like rows with undo button on hover
- Infinite scroll (loads 30 days at a time)
- Drag-and-drop reordering within and across date sections

### UI/UX
- Keyboard-first: Cmd+Shift+Space toggles window, Cmd+N new note, Cmd+K command palette
- **Scratchpad**: Floating quick-capture window (Cmd+Option+Space) for jotting notes without opening the main app
- **Split view**: Cmd+\ to view two notes side by side
- **Index (table of contents)**: Cmd+I toggleable sidebar for notes with headings
- **Backlinks**: Expandable backlink list under each note showing notes that link to it
- **Daily note**: Cmd+J to create/open today's daily note (configurable codex and title format)
- Codexes: group notes into collections with collapsible sidebar, custom emoji icons, and custom colors
- Pinned notes: star notes to pin at top
- **Archive**: Archive notes to hide them from the main list without deleting
- **Duplicate notes**: Right-click context menu or command palette
- Themes: system, light, or dark with customizable accent/background colors per theme, color presets
- Command palette (Cmd+K) for quick actions with pinnable favorites and note search; commands can be hidden from the palette via Settings > Controls (`hiddenCommands` synced preference; hiding is display-only and never disables the underlying keyboard shortcut). Hideable set is the stable registry in `src/utils/commands.ts` (excludes dynamic/contextual/per-codex entries)
- **Reference panel**: Cmd+. toggles a tabbed side panel with Markdown and Controls reference tabs
- **Feature tour**: "Open Feature Tour" command (Cmd+K) launches a guided coachmark overlay (`TourOverlay.tsx`) that spotlights real UI elements (anchored via `data-tour` attributes) with animated step tooltips, then opens a sample "Feature Tour" note. Steps live in `TOUR_STEPS` (utils/featureTour.ts) alongside the note body.
- Zoom support (Cmd+/- for text size)
- System tray with hide-on-close behavior; a "Start hidden in the menu bar" setting (`launchMinimized`, General tab) launches to the tray without showing the window
- Native macOS menu bar with standard shortcuts
- Settings with tabs: General, Organization, Controls, Macros, Dictionary, Emoji, Colors, Storage, Security, Markdown
- **Vault profiles**: Multiple vault locations switchable from the header dropdown; each profile has a name, path, and optional color
- **Settings split**: Local settings (device-specific, including vault profiles, in app config dir) vs portable preferences (synced in .scratch/preferences.json)
- When writing, use a more fun, quirky straightforward language, do not use em-dashes.

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
  components/     React UI components (Editor, NotesList, Settings, Scratchpad, etc.)
  extensions/     Tiptap editor extensions (noteLink, mention, emoji, tagHighlight, taskPriority, taskDueDate, imagePaste)
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
    lib.rs        App initialization, menu, tray, plugins, scratchpad window
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
  - `protection_key`, `protection_hash`: Note protection state
  - `active_note_id`: Currently edited note
- All state wrapped in `Mutex<T>` for thread safety
- Frontend syncs via Tauri IPC commands and event listeners

### Encryption Flow
- **Vault setup**: Generate Argon2id params → derive key → encrypt all notes → save config
- **Vault unlock**: Load config → derive key with Argon2 → verify key → load all notes
- **Fast password verify**: SHA-256 hash check (cached in memory) avoids expensive Argon2 on every check
- **Protection**: Same crypto as vault, but per-note with separate password

### File Operations
- **Filenames are ULID-only**: notes are stored as `{id}.md` / `{id}.snote` / `{id}.pnote` (NOT `{slug}--{id}`). The id is immutable, so a title edit is an in-place write, not a delete+create rename. This is deliberate: Dropbox syncs a rename as delete+create, and two machines renaming the same note concurrently would leave two files sharing one id. Do not reintroduce the title into the filename. Legacy `{slug}--{id}.md` files still load (id comes from frontmatter) and migrate to `{id}.md` on their next save.
- **Atomic writes**: Write to temp file (`.scratch-tmp-{ulid}.md`), then rename to final path. Orphaned temp files are swept by `cleanup_temp_files`.
- **Single write path**: All note writes go through `persist_note` (commands/mod.rs) — it picks the format by vault status, cleans up the old file path, and updates `note.file_path`. Don't hand-roll the `match vault_status { write_note_encrypted | write_note_atomic }` block; call `persist_note`.
- **`find_note_file`** (storage/mod.rs) resolves a note id to its on-disk path across all three formats, with a legacy-suffix fallback.
- **Conflict detection**: Check for Dropbox conflict files (` (Conflicted Copy)`), emit event
- **Trash**: Move to `{notes_folder}/.scratch/trash/` instead of permanent delete
- **Watcher**: Debounced filesystem events trigger `reload_notes` command; the frontend ignores `notes-changed` within 2s of its own save (useNotes.ts) to avoid clobbering the active buffer

### Sync Conflict Handling
Dropbox is last-writer-wins at the file level, so conflicts can't be fully prevented — the strategy is to shrink the race window and never lose data:
- **Optimistic-concurrency guard** (`save_note`): the editor reports the `updated_at` its buffer was based on (`baseUpdatedAt`). On save the backend re-reads the note *from disk* (the in-memory cache lags during active editing) and, if disk is newer, backs up the external version to `.scratch/conflicts/` before letting the save proceed, then emits `save-conflict`. The user's edit is never blocked; the version they'd have clobbered is preserved.
- **Base version is owned by the Editor**, not `loadNotes` — only the editor knows when it adopts external content vs. keeps the user's buffer. It calls `recordBaseVersion(id, updated_at)`; a background reload must NOT reset it or detection breaks.
- **Flush on boundaries**: `flushSave` commits the pending debounced save immediately on editor blur, note switch, and window hide — shrinks the unsynced window.
- **Conflict copies** never leak plaintext: `write_conflict_copy` encrypts with the vault key when the vault is active (`.snote`), else writes `.md`.
- **Resolver**: `list_conflicts` / `resolve_conflict` (actions: `keep-live`, `keep-conflict`, `keep-both`, `delete`) back the `ConflictResolver` component. `resolve_conflict` canonicalizes the path and checks it stays inside `.scratch/conflicts/` (traversal guard).
- **Duplicate-id dedup** (`load_notes_deduped`): if two files still end up with the same id, the newer `updated_at` wins and the older moves to `.scratch/conflicts/`.

### Internal Note Links
- Links stored as `[Title](scratch://id)` (standard markdown, valid format)
- `scratch://` URI scheme distinguishes from normal links (kept for backwards compatibility)
- Title resolved from `notesRef` at parse and serialize time (survives renames)
- `@tiptap/suggestion` handles the `[[` trigger and autocomplete popup
- `ReactRenderer` from `@tiptap/react` renders the suggestion dropdown
- Click navigation via ProseMirror plugin checking `.note-link` class on DOM target

### Dictionary Mentions
- Extension: `src/extensions/mention.tsx`
- Triggered with `@` in the editor, shows autocomplete from user-defined dictionary
- Rendered as styled `<span data-type="mention">` elements
- Dictionary managed in Settings > Dictionary tab

### Custom Emoji
- Extension: `src/extensions/emoji.tsx` — inline atom node modeled on `mention.tsx`
- **Stored as literal `:name:` text in markdown, resolved to an image at render time** (like Slack/Discord). Portable, degrades to `:name:` text if the image is missing mid-sync, and naturally exempt from the per-note image cleanup (that only tracks `.scratch/images/` paths).
- Triggered with `:` via `@tiptap/suggestion`; `renderHTML` resolves the name against `emojisRef` to an `asset://` URL via `convertFileSrc`. Markdown text-rule parse only converts names present in `emojisRef` (same guard as mentions).
- Images live in `.scratch/emojis/` (syncs via Dropbox). Backend commands `list_emojis` / `import_emoji` / `delete_emoji` (commands/mod.rs) validate square + min 100x100, downscale oversized images to 128x128 (`image` crate), and store as `.png`.
- **Starter emoji**: a handful ship with the app (`src-tauri/resources/starter-emojis/`, registered under `bundle.resources` in tauri.conf.json). `seed_starter_emojis` (commands/mod.rs, called from `set_notes_folder`) copies them into `.scratch/emojis/` the first time each is seen, tracked in a `.seeded.json` manifest so a starter the user deletes never reappears (and a later release can ship new starters without resurrecting deleted ones). The manifest is skipped by `list_emojis` because its stem `.seeded` fails `emoji_name_valid`. Seeding runs regardless of vault status (emoji are never encrypted) and is non-fatal.
- Managed in Settings > Emoji tab. Reusable as codex icons: codex icon values are either a `:name:` shortcode or a literal char; `renderCodexIcon` / `CodexIconPicker` (src/components/CodexIconPicker.tsx) handle both.

### Inline Tags
- Extension: `src/extensions/tagHighlight.ts`
- `#tag` syntax highlighted inline with configurable per-tag colors
- Tags are searchable via the search bar (`#tag` filters)
- Tag colors configured in Settings > Organization tab

### Task Extensions
- Priority: `src/extensions/taskPriority.ts` - renders colored pills (!high=red, !med=orange, !low=green) in task items
- Due date: `src/extensions/taskDueDate.ts` - renders date pills (!YYYY-MM-DD) that shift color as deadline approaches

### Optimistic UI
- Title changes update locally before backend save completes
- Frontend assumes success, backend returns updated DTO on completion

### Window State & Visibility (lib.rs)
- `tauri-plugin-window-state` owns **geometry only** — it's built with `StateFlags::SIZE | POSITION | MAXIMIZED` (NOT `all()`, which would include `VISIBLE`). Do not add `VISIBLE`: the plugin would re-show the window from saved state and defeat launch-minimized.
- **Visibility is owned by our code, not the plugin.** The main window is created `visible:false` (tauri.conf.json). The setup hook is the single source of truth for startup: it reads the `launchMinimized` local setting straight from settings.json (`read_bool_setting`, before the frontend loads) — when true, leave it hidden (launch to tray); otherwise `show()` + `set_focus()`. When the key is unset it falls back to the legacy rule of inferring from autostart. Guarded by `showTrayIcon`: launch-minimized is force-disabled when the tray is off (otherwise the app would start with no window and no tray, recoverable only via the global shortcut) — the Settings UI disables the toggle to match. At runtime the tray/close handlers own show/hide.
- Close = hide, not quit: `CloseRequested` saves geometry (while still visible) then `prevent_close()` + `hide()`. Real quit is the tray "Quit" item (`app.exit(0)`).
- Persisted at `{config_dir}/jimothy/.window-state.json` (separate from settings.json).

### Local vs Portable Settings (src/utils/settings.ts + App.tsx)
- `LocalSettings` (device-specific, in `settings.json`) vs `Preferences` (synced, in `.scratch/preferences.json`). `AppSettings = LocalSettings & Preferences`.
- `LOCAL_KEYS` in `src/utils/settings.ts` is the single source of truth for the partition. It MUST list every key in the `LocalSettings` type; anything not listed is treated as portable. `splitSettings(settings)` partitions a full settings object into `{ local, prefs }` (dropping `undefined` values) — used by both the load-migration path and the save path so they can never drift. Keep `LOCAL_KEYS` and the `LocalSettings` type in sync.
- App.tsx has ONE settings writer, `persistSettings(next)`, which calls `splitSettings` and writes both files. `handleSettingsChange` and `handleChangeFolder` both read fresh state from `appSettingsRef.current` (not closure-captured `appSettings`) to avoid a stale-closure clobber when two updates fire in the same tick (e.g. add-profile then change-folder). Do not re-introduce inline partitioning or a second writer.

## Tauri IPC Commands

All commands defined in `src-tauri/src/commands/mod.rs`:

### Notes
- `set_notes_folder(path)` - Initialize notes folder, load notes
- `get_notes_folder()` - Get current notes folder path
- `get_notes()` - Get all notes (returns Vec<NoteDto>)
- `create_note(title, codex)` - Create new note
- `save_note(id, title, body, codex)` - Save note changes
- `set_note_archived(id, archived)` - Archive/unarchive a note
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

### PIN Quick-Unlock
- `pin_enrolled()` - Whether a VAULT PIN is enrolled for the current vault (device-local check, no prompt). Vault-scoped so the vault UnlockScreen keys off it
- `enroll_pin(pin)` - Wrap whichever keys are unlocked right now (vault and/or protection) under a PIN-derived key, stored device-locally. At least one must be unlocked; vault encryption is NOT required (a protection-only user can set a PIN)
- `pin_unlock(pin)` - Attempt PIN unlock of the vault; returns `PinUnlockDto` `{ status: "ok" | "wrong" (with `remaining`) | "wiped" | "not-enrolled" }`. Validates the unwrapped key against the vault verification record before installing it
- `pin_verify(pin)` - Verify a PIN against the vault WITHOUT reinstalling the key (sensitive-note re-auth gate while the vault is unlocked); same `PinUnlockDto`. All three unlock commands share the private `pin_unlock_with` helper (attempt → validate → zeroize-on-stale + `disable` → success closure → `record_success`)
- `pin_protection_enrolled()` - Whether the PIN also covers note protection (separate escrow entry)
- `pin_unlock_protection(pin)` - Unwrap + validate + install the protection key so `.pnote` notes decrypt (plaintext-mode sensitive-note gate); same `PinUnlockDto`
- `disable_pin()` - Remove BOTH the vault and protection PIN escrows for the current vault

### Note Protection
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
- `get_app_settings()` - Load settings.json from config dir (local/device-specific settings)
- `save_app_settings(settings_json)` - Save settings to config dir
- `get_preferences(state)` - Load preferences.json from notes folder (.scratch/preferences.json, portable/synced)
- `save_preferences(prefs_json, state)` - Save preferences to notes folder
- `get_default_notes_path()` - Get default notes path (Dropbox or ~/Jimothy)

### Scratchpad
- `get_scratchpad_entries()` - Get all quick-capture entries
- `append_scratchpad_entry(text)` - Add a new scratchpad entry
- `delete_scratchpad_entry(id)` - Delete a scratchpad entry

### System
- `set_tray_visible(visible)` - Show/hide system tray icon
- `open_scratchpad()` - Toggle the scratchpad window
- `update_global_shortcut(shortcut)` - Change the global toggle-window shortcut
- `update_capture_shortcut(shortcut)` - Change the scratchpad capture shortcut
- `open_folder(path)` - Open a folder in Finder (macOS)
- `check_vault_exists(path)` - Check if a path contains a vault config (.scratch/vault.json)
- `save_image(data, extension)` - Save a pasted/dropped image to `.scratch/images/`, returns absolute path
- `list_emojis()` - List custom emoji in `.scratch/emojis/` (returns `Vec<EmojiEntry>`)
- `import_emoji(data, filename)` - Validate (square, min 100x100), downscale, save emoji as `.png`
- `delete_emoji(name)` - Delete a custom emoji by name

## Configuration Files

### Settings Location
- **macOS**: `~/Library/Application Support/jimothy/settings.json`
- **Windows**: `%APPDATA%/jimothy/settings.json`

### Notes Folder Structure
```
{notes_folder}/
  *.md                      # Plaintext or vault-encrypted notes
  *.pnote                   # File-protected notes
  .scratch/
    vault.json              # Vault config (Argon2 params, verification record)
    protection.json         # Protection config
    preferences.json        # Portable preferences (synced across devices)
    scratchpad.json         # Quick-capture entries
    images/                 # Pasted/dropped images (portable, synced)
    emojis/                 # Custom emoji images (portable, synced)
    trash/                  # Deleted notes
```

## Keyboard Shortcuts

### Global
- `Cmd+Shift+Space` - Toggle window (customizable)
- `Cmd+Option+Space` - Toggle scratchpad (customizable)

### Search & Navigation
- `Cmd+Shift+F` - Search notes
- `Cmd+F` - Find in current note
- `Cmd+H` - Find & replace in current note
- `Cmd+]` / `Cmd+[` - Next/previous match
- `Cmd+N` - New note
- `Cmd+J` - Daily note
- `Cmd+K` - Command palette
- `Cmd+/` - Toggle codex sidebar
- `Cmd+1` - All notes
- `Cmd+2-9` - Switch codex
- `Cmd+Shift+]` / `Cmd+Shift+[` - Next/previous note

### View
- `Cmd+T` - Toggle Tasks view
- `Cmd+I` - Toggle Index (table of contents)
- `Cmd+\`` - Toggle Tasks view (alternate)
- `Cmd+\` - Toggle split view
- `Cmd+=` / `Cmd+-` - Zoom in/out
- `Cmd+0` - Reset zoom

### App
- `Cmd+,` - Settings
- `Cmd+.` - Toggle reference panel
- `Cmd+W` / `Escape` - Banish window

## Release Process

### Committing/Pushing to GitHub
- Do not automatically commit unless asked to
- Do not automatically push to GitHub unless asked to
- Commits should not be co-authored with Claude

### One-time Setup
1. Generate Tauri updater signing keypair: `npx tauri signer generate -w ~/.tauri/jimothy.key`
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

### Adding or changing keyboard shortcuts / reference content
1. Global shortcuts: Register in `src-tauri/src/lib.rs` setup
2. App shortcuts: Handle in React components or native menu
3. Update ALL locations where shortcuts/syntax are displayed:
   - `src/components/ReferencePanel.tsx` (Markdown and Controls tabs)
   - `src/components/Settings.tsx` (Controls tab and Markdown tab)
   - Documentation (README.md, CLAUDE.md, AGENTS.md)

### Adding a Tiptap extension
1. Create `src/extensions/myExtension.tsx`
2. Use @tiptap/core `Node.create()` or `Extension.create()`
3. For autocomplete: use `@tiptap/suggestion` with ReactRenderer for popup
4. Register in Editor.tsx `useEditor({ extensions: [...] })`
5. Handle markdown serialization via `tiptap-markdown` storage options

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
