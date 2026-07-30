# Windows Build Setup Guide

Complete guide for setting up the Jimothy development environment on Windows.

## Prerequisites

### Required Software

1. **Node.js 20 or later**
   - Download from https://nodejs.org/
   - Choose the LTS version
   - Verify installation: `node --version` (should show v20.x or higher)

2. **Rust (stable)**
   - Install via rustup: https://rustup.rs/
   - Download and run `rustup-init.exe`
   - Choose default installation (option 1)
   - Verify installation: `rustc --version`

3. **Microsoft Visual Studio C++ Build Tools**
   - Download Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
   - Scroll down to "Tools for Visual Studio" and download "Build Tools for Visual Studio 2022"
   - During installation, select "Desktop development with C++"
   - Required components (should be auto-selected):
     - MSVC v143+ (latest)
     - Windows 11 SDK (latest)
     - C++ CMake tools for Windows
     - C++ ATL for latest build tools
   - Installation size: ~6-8 GB
   - Restart your computer after installation

4. **WebView2** (usually pre-installed on Windows 11)
   - Check if installed: Look for "Microsoft Edge WebView2 Runtime" in Control Panel > Programs
   - If missing, download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## Step-by-Step Setup

### 1. Install Node.js

```powershell
# After installing Node.js, verify:
node --version
npm --version
```

### 2. Install Rust

```powershell
# Download and run rustup-init.exe from https://rustup.rs/
# Then verify:
rustc --version
cargo --version

# Ensure you have the stable toolchain:
rustup default stable
```

### 3. Install Visual Studio Build Tools

This is the most critical step for Tauri on Windows.

1. Download Build Tools from https://visualstudio.microsoft.com/downloads/
2. Run the installer
3. Select "Desktop development with C++"
4. Click Install (this will take 15-30 minutes)
5. **Restart your computer**

### 4. Clone and Setup Project

```powershell
# Clone the repository
git clone <repository-url>
cd jimothy

# Install Node dependencies
npm install

# Verify Tauri CLI is available
npx tauri --version
```

### 5. Build the Project

```powershell
# Development build with hot reload
npm run tauri dev

# Production build (creates installer in src-tauri/target/release/bundle/)
npm run build
```

## Common Issues and Solutions

### Issue: "link.exe not found" or "MSVC not found"

**Solution:** Install Visual Studio Build Tools with C++ components (see step 3 above).

```powershell
# Verify MSVC is in your PATH by running:
where link.exe
```

If `link.exe` is not found, you need to install or reinstall the Visual Studio Build Tools.

### Issue: "error: linker failed to link"

**Solution:** Make sure you've restarted your computer after installing Visual Studio Build Tools. The environment variables need to be refreshed.

### Issue: WebView2 not found

**Solution:** Install the WebView2 Runtime:
- Download from https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Choose "Evergreen Standalone Installer"

### Issue: Rust compilation is slow

**Solution:** Enable parallel compilation and increase codegen units:

Create or edit `.cargo/config.toml` in the project root:

```toml
[build]
jobs = 8  # Adjust based on your CPU cores

[profile.dev]
codegen-units = 16
```

### Issue: "error: failed to run custom build command"

**Solution:** 
1. Update Rust: `rustup update`
2. Clean build artifacts: `cargo clean --manifest-path src-tauri/Cargo.toml`
3. Try building again: `npm run tauri dev`

### Issue: npm install fails with "gyp ERR!"

**Solution:** Install Windows Build Tools via npm (alternative method):

```powershell
npm install --global windows-build-tools
```

Note: This is a fallback option. The official Visual Studio Build Tools method is preferred.

## Development Workflow

### Running in Development Mode

```powershell
npm run tauri dev
```

This starts the Vite dev server and opens the app with hot reload enabled.

### Running Tests

```powershell
# Frontend tests
npm run test

# TypeScript type checking
npm run typecheck

# Rust tests
cargo test --manifest-path src-tauri/Cargo.toml
```

### Building for Production

```powershell
# Create production build
npm run build
```

The installer will be created at:
- `src-tauri/target/release/bundle/msi/Jimothy_<version>_x64_en-US.msi` (MSI installer)
- `src-tauri/target/release/bundle/nsis/Jimothy_<version>_x64-setup.exe` (NSIS installer)

### Cleaning Build Artifacts

```powershell
# Clean Rust build
cargo clean --manifest-path src-tauri/Cargo.toml

# Clean Node modules (if needed)
Remove-Item -Recurse -Force node_modules
npm install
```

## Verifying Your Setup

Run this checklist to ensure everything is installed correctly:

```powershell
# 1. Node.js (should be 20+)
node --version

# 2. npm
npm --version

# 3. Rust (should be stable)
rustc --version
cargo --version

# 4. MSVC linker
where link.exe

# 5. Tauri CLI
npx tauri --version

# 6. Try building the project
npm run tauri dev
```

If all commands succeed and the app opens, your setup is complete!

## Additional Tools (Optional)

### PowerShell 7+

Modern PowerShell with better performance and cross-platform support:
- Download from: https://aka.ms/powershell

### Windows Terminal

Better terminal experience:
- Install from Microsoft Store: https://aka.ms/terminal

### Git for Windows

If you don't have Git installed:
- Download from: https://git-scm.com/download/win
- Choose "Git Bash" during installation for Unix-like commands

## Performance Tips

1. **Exclude project folder from Windows Defender:**
   - Windows Security > Virus & threat protection > Manage settings
   - Add exclusion for your project folder
   - This significantly speeds up build times

2. **Use SSD for project:**
   - Rust compilation is I/O intensive
   - Store project on SSD rather than HDD

3. **Close unnecessary applications:**
   - Tauri builds are CPU and memory intensive
   - Close other apps during compilation

## Next Steps

Once your setup is complete:
1. Read the main [CLAUDE.md](./CLAUDE.md) for architecture and conventions
2. Check out [README.md](./README.md) for feature overview
3. Run `npm run tauri dev` to start developing
4. Join our development chat (if applicable)

## Troubleshooting Resources

- Tauri Prerequisites: https://v2.tauri.app/start/prerequisites/#windows
- Rust on Windows: https://rust-lang.github.io/rustup/installation/windows.html
- Tauri Discord: https://discord.gg/tauri
- GitHub Issues: <repository-url>/issues
