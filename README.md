# Port Manager

A desktop app to view and manage listening ports across **all sources** — WSL, Windows, Docker, SSH tunnels, kubectl port-forwards, and netsh portproxy rules — in one place.

Built with Electron. Runs on WSL+Windows, macOS, or native Linux.

## Features

- Scans all port-producing services simultaneously:
  - **WSL** ports (via `ss`)
  - **Windows** ports (via PowerShell)
  - **Docker** container port mappings
  - **SSH** tunnels (`-L` and `-D` forwards)
  - **kubectl** port-forwards
  - **netsh portproxy** rules (Windows)
  - **macOS** ports (via `lsof`)
  - **Linux** native ports (via `ss`)
- **Mapping column** shows port forwarding relationships (e.g., `→ 4000`)
- **Type filter** — view Direct (listen) or Forwarded ports only
- **Source filter** — dynamically populated from detected sources
- Stop/disconnect any source directly from the UI:
  - Docker: graceful stop → force kill
  - SSH/kubectl: disconnect tunnel
  - PortProxy: remove rule
  - Processes: terminate by PID
- Search across port, process, container name, image, mapping, and tunnel target
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
  scanner.js          # Port scanning orchestrator + registry
  platform.js         # Platform detection (wsl/windows/macos/linux)
  docker-scanner.js   # Docker container port mappings
  ssh-scanner.js      # SSH tunnel detection (-L/-D)
  k8s-scanner.js      # kubectl port-forward detection
  portproxy-scanner.js # netsh portproxy rules
  macos-scanner.js    # macOS lsof-based scanning
  linux-scanner.js    # Native Linux ss-based scanning
  process-manager.js  # Source-aware process termination
  settings.js         # Persistent settings (electron-store)
  main.js             # Electron main process + IPC
  preload.js          # Secure IPC bridge
renderer/
  index.html          # Main window
  styles/             # Dark/light themes + components
  js/                 # UI modules (table, settings, toast, app)
bin/
  cli.js              # CLI entry point
tests/                # Jest test suites (135+ tests)
```

## Platform Support

| Platform | Base Scanners | Cross-Platform |
|----------|--------------|----------------|
| WSL | WSL + Windows + PortProxy | Docker, SSH, K8s |
| Windows | Windows + PortProxy | Docker, SSH, K8s |
| macOS | macOS | Docker, SSH, K8s |
| Linux | Linux | Docker, SSH, K8s |

## Requirements

- **Node.js** 18+
- One of: WSL+Windows, macOS, or Linux
- Optional: Docker, SSH, kubectl (for respective scanners)

## License

MIT
