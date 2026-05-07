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

### WSL Ports

Run `ss -tlnp` and `ss -ulnp` to capture TCP and UDP listening ports:

```
ss -tlnp 2>/dev/null
ss -ulnp 2>/dev/null
```

Parse output to extract: state, local address, port, PID, process name.

### Windows Ports

Run via `powershell.exe`:

```powershell
Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,State,OwningProcess | ConvertTo-Json
```

Then resolve process names:

```powershell
Get-Process -Id <PID> | Select-Object Id,ProcessName | ConvertTo-Json
```

### Data Model

Each port entry is normalized to:

```typescript
interface PortEntry {
  port: number;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  state: string;          // LISTEN, ESTABLISHED, TIME_WAIT, etc.
  pid: number;
  processName: string;
  source: 'WSL' | 'Windows';
}
```

### Deduplication

Ports that appear in both WSL and Windows scans (due to WSL port forwarding) are shown as separate rows but visually grouped or annotated.

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

- **Search bar**: filters across all text columns (port, process name, address, state)
- **Source dropdown**: All / WSL / Windows
- **State filter**: All / LISTEN / ESTABLISHED / other

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

## Process Killing

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

Generate a `.desktop` file at `~/.local/share/applications/port-manager.desktop`:

```ini
[Desktop Entry]
Name=Port Manager
Exec=/path/to/port-manager/bin/cli.js
Icon=/path/to/port-manager/assets/icon.png
Type=Application
Categories=Development;System;
```

### 3. Windows Shortcut

A `launch.bat` file in the project root:

```batch
@echo off
wsl -e bash -c "cd ~/port-manager && npm start"
```

User can pin this to taskbar or create a desktop shortcut.

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
