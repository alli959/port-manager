# Port Manager — Design Spec

## Overview

A standalone Electron desktop app that displays all open ports across both WSL and Windows in a unified, sortable, filterable table. Users can see what each port is running and stop processes directly from the UI.

## Goals

- Single view of all open ports across WSL and Windows
- Clear identification of which environment each port belongs to
- Ability to stop any running process from the UI
- Launchable from CLI (`port-manager` / `pm`) and as a desktop app
- Polished dark-first UI with theme options

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process                          │
│                                                 │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │ Port Scanner  │    │ Process Manager       │  │
│  │              │    │                       │  │
│  │ WSL Scanner  │    │ kill (WSL PIDs)       │  │
│  │  ss -tlnp    │    │ Stop-Process (Win)    │  │
│  │  ss -ulnp    │    │                       │  │
│  │              │    └───────────────────────┘  │
│  │ Win Scanner  │                               │
│  │  PowerShell  │    ┌───────────────────────┐  │
│  │  Get-Net...  │    │ Settings Store        │  │
│  │              │    │  electron-store       │  │
│  └──────────────┘    └───────────────────────┘  │
│         │                                       │
│         │ IPC (contextBridge)                    │
├─────────┼───────────────────────────────────────┤
│         ▼                                       │
│  Electron Renderer Process                      │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  Port Table UI                           │   │
│  │  - Sortable columns                      │   │
│  │  - Search filter bar                     │   │
│  │  - Source filter (All / WSL / Windows)    │   │
│  │  - Auto-refresh + manual refresh         │   │
│  │  - Stop button per row                   │   │
│  │  - Settings panel (theme, interval, etc) │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Tech Stack

| Component       | Technology                      |
| --------------- | ------------------------------- |
| Framework       | Electron 30+                    |
| Renderer        | Vanilla HTML/CSS/JS (no framework overhead) |
| IPC             | Electron contextBridge + ipcMain/ipcRenderer |
| Settings        | electron-store                  |
| Port scanning   | child_process (ss, PowerShell)  |
| Styling         | CSS custom properties for theming |
| CLI entry       | npm global link with bin field  |

## Port Scanning

### Scope

The app scans for **listening TCP and UDP ports** across both WSL and Windows. This answers the question "what is using my ports right now?" — which is the primary use case. Non-listening states (ESTABLISHED, TIME_WAIT, etc.) are excluded to keep the table focused and actionable.

### WSL Ports

Run `ss -tlnp` and `ss -ulnp` to capture TCP and UDP ports:

```
ss -tlnp 2>/dev/null    # TCP listening
ss -ulnp 2>/dev/null    # UDP listening
```

Parse output to extract: state, local address, port, PID, process name.

### Windows Ports

Run via `powershell.exe`:

**TCP (listening only):**
```powershell
Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,State,OwningProcess | ConvertTo-Json
```

**UDP:**
```powershell
Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json
```

Then resolve process names in a single batch call:

```powershell
Get-Process -Id <PID1>,<PID2>,... | Select-Object Id,ProcessName | ConvertTo-Json
```

### Data Model

Each port entry is normalized to:

```typescript
interface PortEntry {
  port: number;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  state: string;          // LISTEN for TCP, '*' for UDP (stateless)
  pid: number | null;     // null when PID cannot be resolved (e.g., kernel threads, permission denied)
  processName: string;    // '<unknown>' when process name cannot be resolved
  source: 'WSL' | 'Windows';
}
```

When `pid` is `null` or `processName` is `'<unknown>'`:
- The table displays "—" for PID and/or "Unknown" with a muted style for Process
- The Stop button is **disabled** (greyed out, with tooltip: "Cannot stop — unknown process")

### Deduplication

Ports forwarded by WSL appear in both WSL and Windows scans. These are shown as **separate rows** — each tagged with its source badge (WSL / Windows). No grouping or merging is performed; the user can filter by source to isolate one environment.

## UI Design

### Table Columns

| # | Column        | Sortable | Description                        |
|---|---------------|----------|------------------------------------|
| 1 | Port          | Yes      | Port number                        |
| 2 | Protocol      | Yes      | TCP or UDP                         |
| 3 | Local Address | Yes      | Bound address (0.0.0.0, 127.0.0.1) |
| 4 | State         | Yes      | Connection state                   |
| 5 | PID           | Yes      | Process ID                         |
| 6 | Process       | Yes      | Process name                       |
| 7 | Source        | Yes      | WSL or Windows badge               |
| 8 | Actions       | No       | Stop button                        |

### Filtering

- **Search bar**: filters across all text columns (port, process name, address)
- **Source dropdown**: All / WSL / Windows

### Sorting

- Click column header to sort ascending; click again for descending
- Visual indicator (▲/▼) on active sort column

### Refresh

- **Auto-refresh**: every 5 seconds by default (configurable: 1s, 3s, 5s, 10s, 30s, off)
- **Manual refresh**: button in the toolbar
- **Visual indicator**: subtle pulse/spinner during scan

### Actions — Stop Process

- Each row has a **Stop** button (red, with stop icon)
- Default behavior: confirmation dialog ("Stop process `node` (PID 1234) on port 3000?")
- Confirmation can be toggled off in settings
- After stopping: row disappears on next refresh, toast notification confirms

### Settings Panel

Accessible via gear icon in the toolbar. Settings:

| Setting              | Options                              | Default        |
|----------------------|--------------------------------------|----------------|
| Theme                | Dark / Light / System                | Dark           |
| Auto-refresh interval| 1s, 3s, 5s, 10s, 30s, Off          | 5s             |
| Confirm before stop  | On / Off                             | On             |

Settings persisted via `electron-store`.

### Theming

CSS custom properties for all colors:

- `--bg-primary`, `--bg-secondary`, `--bg-row-hover`
- `--text-primary`, `--text-secondary`
- `--accent`, `--danger`
- `--border`

Three theme files: `dark.css`, `light.css`, system detection via `prefers-color-scheme`.

## IPC Contracts

The preload script (`preload.js`) exposes the following API to the renderer via `contextBridge.exposeInMainWorld('portManager', ...)`:

### Channels (Renderer → Main)

| Channel          | Payload                  | Response                          |
|------------------|--------------------------|-----------------------------------|
| `scan-ports`     | none                     | `{ ports: PortEntry[], errors: ScanError[] }` |
| `kill-process`   | `{ pid: number, source: 'WSL' \| 'Windows' }` | `{ success: boolean, error?: string }` |
| `get-settings`   | none                     | `Settings`                        |
| `set-settings`   | `Partial<Settings>`      | `Settings` (updated)              |

### Channels (Main → Renderer)

| Channel              | Payload      | Description                                   |
|----------------------|--------------|-----------------------------------------------|
| `settings-changed`   | `Settings`   | Pushed when settings change (e.g., theme via system preference) |

### Types

```typescript
interface ScanError {
  source: 'WSL' | 'Windows';
  message: string;   // e.g., "PowerShell not found", "ss command failed"
}

interface Settings {
  theme: 'dark' | 'light' | 'system';
  refreshInterval: number;   // milliseconds (1000, 3000, 5000, 10000, 30000, 0 = off)
  confirmBeforeStop: boolean;
}
```

### Partial Failure Behavior

Scanning runs WSL and Windows scans in parallel (via `Promise.allSettled`). If one fails:
- The successful scan's results are returned normally in `ports`
- The failed scan produces a `ScanError` in `errors`
- The renderer shows a warning banner for the failed source (e.g., "⚠ Windows ports unavailable") while still displaying the working source's data
- On next refresh, the failed source is retried
- If both sources fail, the table shows an empty state with both error banners

### Scan Lifecycle

- Each scan has a **5-second timeout**. If a scan exceeds this, it is killed and produces a `ScanError`
- Auto-refresh waits for the current scan to complete before scheduling the next one (no overlapping scans)
- During a scan, the refresh button shows a spinner and is disabled
- First load triggers an immediate scan; auto-refresh timer starts after the first scan completes

### State Ownership

| State                  | Owner               |
|------------------------|----------------------|
| Port data (raw)        | Main process (scanner) |
| Sort column/direction  | Renderer (table.js)  |
| Filter text/dropdowns  | Renderer (table.js)  |
| Refresh timer          | Renderer (app.js)    |
| Settings               | Main process (electron-store), pushed to renderer via `settings-changed` IPC on change |

## Process Killing

Kill is always **forceful** (`kill -9` for WSL, `Stop-Process -Force` for Windows). No graceful-first fallback — the user explicitly chose to stop the process.

### WSL Processes

```javascript
const { execSync } = require('child_process');
execSync(`kill -9 ${pid}`);
```

### Windows Processes

```javascript
execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force"`);
```

### Error Handling

- Permission denied: show error toast ("Cannot stop system process — run as admin")
- Process already gone: silently succeed, remove from table on refresh
- Invalid PID: show error toast

## Launch Methods

### Install Script

A `postinstall` npm script (`scripts/install.sh`) handles launcher generation:

1. Resolves the absolute install path
2. Generates `~/.local/share/applications/port-manager.desktop` with resolved paths
3. Generates `launch.bat` in the project root with resolved paths
4. Makes `bin/cli.js` executable

On cleanup, users can run `scripts/uninstall.sh` which removes the `.desktop` file and `launch.bat`.

### 1. CLI Commands

`package.json` defines bin entries:

```json
{
  "bin": {
    "port-manager": "./bin/cli.js",
    "pm": "./bin/cli.js"
  }
}
```

After `npm link`, both `port-manager` and `pm` launch the Electron app from any WSL terminal.

`bin/cli.js`:

```javascript
#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
execSync(`npx electron ${path.join(__dirname, '..')}`, { stdio: 'inherit' });
```

### 2. Desktop Shortcut (WSLg)

Generated during `npm link` setup. Creates a `.desktop` file at `~/.local/share/applications/port-manager.desktop`:

```ini
[Desktop Entry]
Name=Port Manager
Exec=RESOLVED_PATH/bin/cli.js
Icon=RESOLVED_PATH/assets/icon.png
Type=Application
Categories=Development;System;
```

Where `RESOLVED_PATH` is dynamically resolved to the actual install path at link time (e.g., `/home/alexanderg/port-manager`).

### 3. Windows Shortcut

A `launch.bat` file is generated in the project root with the resolved WSL path:

```batch
@echo off
wsl -e bash -lc "RESOLVED_PATH/bin/cli.js"
```

Where `RESOLVED_PATH` is the absolute path resolved at install time. User can copy this to their Desktop or pin to taskbar.

## File Structure

```
port-manager/
├── package.json
├── bin/
│   └── cli.js              # CLI entry point
├── main/
│   ├── main.js             # Electron main process
│   ├── preload.js           # contextBridge for IPC
│   ├── scanner.js           # Port scanning logic
│   ├── process-manager.js   # Kill process logic
│   └── settings.js          # electron-store wrapper
├── renderer/
│   ├── index.html           # Main window HTML
│   ├── styles/
│   │   ├── main.css         # Base styles + table
│   │   ├── dark.css         # Dark theme variables
│   │   ├── light.css        # Light theme variables
│   │   └── components.css   # Buttons, badges, dialogs
│   └── js/
│       ├── app.js           # Main renderer logic
│       ├── table.js         # Sort/filter/render table
│       ├── settings-ui.js   # Settings panel logic
│       └── toast.js         # Toast notifications
├── scripts/
│   ├── install.sh           # Generates .desktop + launch.bat with resolved paths
│   └── uninstall.sh         # Removes generated launchers
├── assets/
│   └── icon.png             # App icon
├── launch.bat               # Windows launcher
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-07-port-manager-design.md
└── README.md
```

## Security

- **contextIsolation: true** — renderer cannot access Node APIs directly
- **nodeIntegration: false** — all Node operations go through preload bridge
- **PID validation** — only numeric PIDs accepted, no shell injection
- **No remote content** — app is fully local

## Error Handling

| Scenario                  | Behavior                                        |
|---------------------------|-------------------------------------------------|
| PowerShell not found      | Show "Windows ports unavailable" warning         |
| ss command fails          | Show "WSL ports unavailable" warning             |
| Permission denied on kill | Toast: "Cannot stop — insufficient permissions" |
| Process already exited    | Silent success, removed on next refresh          |
| Scan timeout              | Show stale data with "scan failed" indicator     |

## Testing Strategy

- **Unit tests**: scanner parsing logic (mock ss/PowerShell output)
- **Integration tests**: IPC communication between main and renderer
- **Manual testing**: verify on actual WSL + Windows environment
