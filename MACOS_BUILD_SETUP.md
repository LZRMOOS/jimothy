# macOS Build Setup Guide

Complete guide for setting up the Jimothy development environment on macOS.

## Prerequisites

### Required Software

1. **Xcode Command Line Tools**
   - Required for C/C++ compilation and system libraries
   - Size: ~1.5 GB
   - Installation: `xcode-select --install`

2. **Node.js 20 or later**
   - Download from https://nodejs.org/
   - Choose the LTS version
   - Alternative: Install via Homebrew `brew install node`
   - Verify installation: `node --version` (should show v20.x or higher)

3. **Rust (stable)**
   - Install via rustup: https://rustup.rs/
   - One-line install: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
   - Verify installation: `rustc --version`

### Optional but Recommended

- **Homebrew** - Package manager for macOS
  - Install: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
  - Makes installing Node.js and other tools easier

## Step-by-Step Setup

### 1. Install Xcode Command Line Tools

This provides the C compiler and system headers needed for Rust native dependencies.

```bash
# Install Command Line Tools
xcode-select --install
```

A dialog will appear. Click "Install" and wait for it to complete (5-10 minutes).

**Verify installation:**
```bash
xcode-select -p
# Should output: /Library/Developer/CommandLineTools

# Check for compiler
clang --version
# Should show Apple clang version
```

### 2. Install Node.js

**Option A: Direct Download**
1. Download from https://nodejs.org/
2. Run the installer package
3. Follow the installation wizard

**Option B: Homebrew (Recommended)**
```bash
brew install node
```

**Verify installation:**
```bash
node --version   # Should be v20.x or higher
npm --version    # Should be v10.x or higher
```

### 3. Install Rust

```bash
# Install rustup (Rust installer and version manager)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Choose option 1 (default installation)

# Restart your terminal or run:
source $HOME/.cargo/env

# Verify installation
rustc --version
cargo --version

# Ensure you have the stable toolchain
rustup default stable
```

### 4. Clone and Setup Project

```bash
# Clone the repository
git clone <repository-url>
cd jimothy

# Install Node dependencies
npm install

# Verify Tauri CLI is available
npx tauri --version
```

### 5. Build the Project

```bash
# Development build with hot reload
npm run tauri dev

# Production build (creates .dmg in src-tauri/target/release/bundle/)
npm run build
```

## Common Issues and Solutions

### Issue: "xcrun: error: invalid active developer path"

**Solution:** Install or reinstall Xcode Command Line Tools:

```bash
xcode-select --install
```

If that fails:
```bash
# Remove old installation
sudo rm -rf /Library/Developer/CommandLineTools

# Reinstall
xcode-select --install
```

### Issue: "command not found: cargo" after installing Rust

**Solution:** Restart your terminal or reload your shell configuration:

```bash
# For bash
source ~/.bashrc

# For zsh (default on macOS Catalina+)
source ~/.zshrc

# Or simply restart your terminal
```

### Issue: Permission denied when running npm install

**Solution:** Fix npm permissions (don't use sudo with npm):

```bash
# Change npm's default directory
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'

# Add to PATH (add this to ~/.zshrc or ~/.bashrc)
export PATH=~/.npm-global/bin:$PATH

# Reload shell
source ~/.zshrc  # or ~/.bashrc
```

### Issue: "ld: framework not found CoreFoundation"

**Solution:** Reinstall Xcode Command Line Tools and ensure they're selected:

```bash
sudo xcode-select --reset
xcode-select --install
```

### Issue: Rust compilation is slow

**Solution:** Enable parallel compilation:

Create or edit `.cargo/config.toml` in the project root:

```toml
[build]
jobs = 8  # Adjust based on your CPU cores

[profile.dev]
split-debuginfo = "unpacked"  # Speeds up linking on macOS
```

### Issue: "error: failed to run custom build command"

**Solution:**
1. Update Rust: `rustup update`
2. Clean build artifacts: `cargo clean --manifest-path src-tauri/Cargo.toml`
3. Try building again: `npm run tauri dev`

### Issue: App won't open - "App is damaged and can't be opened"

This happens with unsigned development builds.

**Solution:**
```bash
# Remove quarantine attribute
xattr -cr "src-tauri/target/release/bundle/macos/Jimothy.app"

# Or allow the app in System Settings:
# System Settings > Privacy & Security > Security > "Open Anyway"
```

### Issue: Global shortcut not working

**Solution:** Grant Accessibility permissions:
1. System Settings > Privacy & Security > Accessibility
2. Add your terminal app (Terminal.app, iTerm, etc.)
3. Restart the app

### Issue: "codesign" errors during build

**Solution:** For development, you can skip code signing:

Edit `src-tauri/tauri.conf.json`:
```json
{
  "bundle": {
    "macOS": {
      "signingIdentity": null
    }
  }
}
```

For distribution, you'll need an Apple Developer account and certificate.

## macOS-Specific Features

### System Integration

Jimothy integrates with macOS in these ways:

1. **Menu Bar** - Native macOS menu with standard shortcuts
2. **System Tray** - Lives in the menu bar when minimized
3. **Global Shortcuts** - Works even when app is in background
4. **Sleep Detection** - Auto-locks vault on system sleep (via IOKit)
5. **Native Notifications** - Uses macOS notification center

### Permissions

The app may request these permissions:

- **Accessibility** - For global shortcuts (optional but recommended)
- **Notifications** - For update alerts and conflict warnings
- **Full Disk Access** - Only if your notes folder is in a protected location like Desktop or Documents

Grant permissions in: System Settings > Privacy & Security

## Development Workflow

### Running in Development Mode

```bash
npm run tauri dev
```

This starts the Vite dev server and opens the app with hot reload enabled.

### Running Tests

```bash
# Frontend tests
npm run test

# TypeScript type checking
npm run typecheck

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run all checks
npm run typecheck && npm run test && cargo test --manifest-path src-tauri/Cargo.toml
```

### Building for Production

```bash
# Create production build
npm run build
```

The artifacts will be created at:
- **App Bundle**: `src-tauri/target/release/bundle/macos/Jimothy.app`
- **DMG Installer**: `src-tauri/target/release/bundle/dmg/Jimothy_<version>_universal.dmg`

### Cleaning Build Artifacts

```bash
# Clean Rust build
cargo clean --manifest-path src-tauri/Cargo.toml

# Clean Node modules (if needed)
rm -rf node_modules
npm install

# Clean npm cache (if having dependency issues)
npm cache clean --force
```

## Architecture Notes

### Universal Binary (Apple Silicon + Intel)

Tauri 2 builds universal binaries by default, supporting both:
- **Apple Silicon** (M1, M2, M3, M4 chips) - arm64
- **Intel Macs** - x86_64

If you want to build for only your architecture during development (faster):

```bash
# Just your architecture (faster for development)
npm run tauri dev -- --target $(rustc -vV | sed -n 's|host: ||p')

# Universal binary (for distribution)
npm run build
```

### Code Signing for Distribution

For distributing outside the App Store, you need:

1. **Apple Developer Account** ($99/year)
2. **Developer ID Certificate**
3. **Notarization**

Setup:
```bash
# Install your certificate from Apple Developer portal
# Then configure in src-tauri/tauri.conf.json:
{
  "bundle": {
    "macOS": {
      "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
      "entitlements": "entitlements.plist"
    }
  }
}
```

See Tauri's [macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) for details.

## Verifying Your Setup

Run this checklist to ensure everything is installed correctly:

```bash
# 1. Xcode Command Line Tools
xcode-select -p
clang --version

# 2. Node.js (should be 20+)
node --version
npm --version

# 3. Rust (should be stable)
rustc --version
cargo --version

# 4. Tauri CLI
npx tauri --version

# 5. Try building the project
cd /path/to/jimothy
npm run tauri dev
```

If all commands succeed and the app opens, your setup is complete!

## Performance Tips

1. **Use an SSD:**
   - Rust compilation is I/O intensive
   - External HDDs will be significantly slower

2. **Increase file watcher limits:**
   ```bash
   # Add to ~/.zshrc or ~/.bashrc
   ulimit -n 10240
   ```

3. **Disable Spotlight indexing for build directories:**
   ```bash
   # Add target/ to Spotlight exclusions
   # System Settings > Siri & Spotlight > Spotlight Privacy
   # Add: /path/to/jimothy/src-tauri/target
   ```

4. **Enable incremental compilation:**
   Already enabled by default in Rust, but you can verify in `.cargo/config.toml`:
   ```toml
   [build]
   incremental = true
   ```

5. **Close unnecessary applications:**
   - Tauri builds are CPU and memory intensive
   - Close other apps during compilation

## Recommended Development Tools

### Terminal

- **iTerm2** - Better terminal than Terminal.app
  - Download: https://iterm2.com/
  - Features: split panes, search, better performance

### Shell

- **Oh My Zsh** - Framework for managing Zsh configuration
  ```bash
  sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
  ```

### Editor

If not already using VS Code or a JetBrains IDE:
- **VS Code** with extensions:
  - rust-analyzer (Rust language server)
  - Tauri (Tauri development tools)
  - ESLint (TypeScript/JavaScript linting)
  - Prettier (Code formatting)

## Next Steps

Once your setup is complete:
1. Read the main [CLAUDE.md](./CLAUDE.md) for architecture and conventions
2. Check out [README.md](./README.md) for feature overview
3. Run `npm run tauri dev` to start developing
4. Review keyboard shortcuts (Cmd+K opens command palette in the app)

## Troubleshooting Resources

- Tauri Prerequisites: https://v2.tauri.app/start/prerequisites/#macos
- Rust on macOS: https://www.rust-lang.org/tools/install
- Tauri Discord: https://discord.gg/tauri
- GitHub Issues: <repository-url>/issues

## Upgrading Dependencies

### Update Rust
```bash
rustup update stable
```

### Update Node.js
```bash
# If installed via Homebrew:
brew upgrade node

# If installed via nodejs.org:
# Download latest from https://nodejs.org/
```

### Update Project Dependencies
```bash
# Update npm packages
npm update

# Update Rust crates
cargo update --manifest-path src-tauri/Cargo.toml
```

## Uninstalling (if needed)

### Uninstall Node.js
```bash
# If installed via Homebrew:
brew uninstall node

# If installed via nodejs.org:
sudo rm -rf /usr/local/{bin/{node,npm},lib/node_modules/npm,lib/node,share/man/*/node.*}
```

### Uninstall Rust
```bash
rustup self uninstall
```

### Uninstall Xcode Command Line Tools
```bash
sudo rm -rf /Library/Developer/CommandLineTools
```
