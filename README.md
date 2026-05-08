# Port Manager

A desktop app to view and manage listening ports across **WSL** and **Windows** — all in one place.

Built with Electron. Runs from WSL.

## Features

- Scans both WSL and Windows listening ports simultaneously
- Stop any process directly from the UI
- Search and filter by port, process name, address, or source
- Sort columns with one click
- Dark / Light / System theme
- Auto-refresh with configurable intervals
- CLI mode for quick terminal lookups

## Quick Start

```bash
# Clone & install
git clone <repo-url> port-manager
cd port-manager
npm install

# Launch GUI
npm start

# Or use CLI
node bin/cli.js list
```

## CLI Usage

```bash
port-manager              # Launch GUI
port-manager list          # List ports in terminal
port-manager help          # Show help
port-manager --version     # Show version
```

## Setup (Global CLI)

```bash
bash scripts/install.sh    # Install dependencies + link CLI
bash scripts/uninstall.sh  # Remove CLI links
```

## Development

```bash
npm test          # Run tests
npm start         # Launch app
```

## Architecture

```
main/
  scanner.js          # Port scanning (WSL ss + Windows PowerShell)
  process-manager.js  # Process termination
  settings.js         # Persistent settings (electron-store)
  main.js             # Electron main process + IPC
  preload.js          # Secure IPC bridge
renderer/
  index.html          # Main window
  styles/             # Dark/light themes + components
  js/                 # UI modules (table, settings, toast, app)
bin/
  cli.js              # CLI entry point
tests/                # Jest test suites
```

## Requirements

- **WSL** (Ubuntu or similar)
- **Node.js** 18+
- **Windows** host (for Windows port scanning)

## License

MIT
