# Multi-Source Port Scanning & Port Forwarding — Design Spec

## Overview

Extend Port Manager to scan all port-producing services on the system — not just WSL and Windows listening ports — and display port forwarding relationships (e.g., 3000→4000). New sources include Docker containers, SSH tunnels, kubectl port-forwards, and Windows netsh port proxy rules. The app becomes fully cross-platform (WSL+Windows, macOS, native Linux).

## Goals

- Show every service that occupies a port, regardless of origin
- Clearly display port forwarding/mapping relationships in a dedicated column
- Support Docker, SSH, kubectl, and netsh portproxy as first-class sources
- Full cross-platform support: WSL+Windows, macOS, Linux
- Allow stopping/disconnecting any source type from the UI
- Graceful degradation when tools aren't installed

## Extended Data Model

```typescript
interface PortEntry {
  // Existing fields
  port: number;
  protocol: 'TCP' | 'UDP';
  localAddress: string;
  state: string;
  pid: number | null;
  processName: string;
  source: 'WSL' | 'Windows' | 'Docker' | 'SSH' | 'Kubernetes' | 'PortProxy' | 'macOS' | 'Linux';

  // New fields
  type: 'listen' | 'forward';
  mapping: string | null;
  containerName: string | null;
  containerImage: string | null;
  containerId: string | null;
  tunnelTarget: string | null;
}
```

### Field Semantics

| Field | Purpose |
|-------|---------|
| `type` | Distinguishes direct listening ports from forwarded/proxied ports |
| `mapping` | Human-readable forwarding target (e.g., "→ 4000", "→ remotehost:4000") or null |
| `containerName` | Docker container name (null for non-Docker) |
| `containerImage` | Docker image (null for non-Docker) |
| `containerId` | Docker container ID for stop/kill actions (null for non-Docker) |
| `tunnelTarget` | SSH or kubectl target description (null for non-tunnel) |

## Platform Strategy

### Platform Detection (`main/platform.js`)

```javascript
function getPlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (isWSL()) return 'wsl';
  return 'linux';
}

function isWSL() {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}
```

### Scanner Activation by Platform

| Scanner | WSL | Windows (native) | macOS | Linux |
|---------|-----|-------------------|-------|-------|
| WSL (ss) | ✅ | ❌ | ❌ | ❌ |
| Windows (PowerShell) | ✅ | ✅ | ❌ | ❌ |
| macOS (lsof) | ❌ | ❌ | ✅ | ❌ |
| Linux (ss) | ❌ | ❌ | ❌ | ✅ |
| netsh portproxy | ✅ | ✅ | ❌ | ❌ |
| Docker | ✅ | ✅ | ✅ | ✅ |
| SSH | ✅ | ✅ | ✅ | ✅ |
| Kubernetes | ✅ | ✅ | ✅ | ✅ |

## New Scanners

### Docker Scanner (`main/docker-scanner.js`)

**Command:**
```bash
docker ps --format '{{json .}}'
```

**Parsing:** Each JSON line contains a `Ports` field with format:
- `0.0.0.0:3000->4000/tcp` — host port 3000 mapped to container port 4000
- `:::3000->4000/tcp` — IPv6 variant
- `0.0.0.0:8000-8010->8000-8010/tcp` — port range
- `4000/tcp` — exposed but not published (skip these)

**Output per published port:**
```javascript
{
  port: 3000,
  protocol: 'TCP',
  localAddress: '0.0.0.0',
  state: 'LISTEN',
  pid: null,
  processName: 'my-app (nginx:latest)',
  source: 'Docker',
  type: 'forward',
  mapping: '→ 4000',
  containerName: 'my-app',
  containerImage: 'nginx:latest',
  containerId: 'abc123def456',
  tunnelTarget: null
}
```

**Availability:** If `docker` command not found or daemon not running, return empty array (no error).

### SSH Scanner (`main/ssh-scanner.js`)

**Detection strategy:**

1. On Linux/WSL/macOS: find SSH processes listening on ports
2. Read process command line to identify forwarding flags

**Linux/WSL:**
```bash
# Find SSH PIDs from ss output (already available from base scan)
# Then read /proc/<pid>/cmdline for forwarding flags
cat /proc/<pid>/cmdline | tr '\0' ' '
```

**macOS fallback:**
```bash
ps -o args= -p <pid>
```

**Parsing `-L` flags:**
- `-L 3000:localhost:4000` → port 3000, mapping "→ localhost:4000"
- `-L 3000:remotehost:4000` → port 3000, mapping "→ remotehost:4000"
- `-L [bind_address:]port:host:hostport` (full format)

**Parsing `-R` flags:**
- `-R 4000:localhost:3000` → remote port 4000 forwards to local 3000 (shown as informational)

**Output:**
```javascript
{
  port: 3000,
  protocol: 'TCP',
  localAddress: '127.0.0.1',
  state: 'LISTEN',
  pid: 5678,
  processName: 'ssh',
  source: 'SSH',
  type: 'forward',
  mapping: '→ remotehost:4000',
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: 'remotehost:4000'
}
```

### Kubernetes Scanner (`main/k8s-scanner.js`)

**Detection:**
```bash
# Linux/WSL/macOS
ps aux | grep '[k]ubectl.*port-forward'

# Alternative: pgrep + cmdline
pgrep -f 'kubectl.*port-forward'
```

**Command parsing examples:**
- `kubectl port-forward pod/nginx 8080:80` → port 8080, mapping "→ pod/nginx:80"
- `kubectl port-forward svc/my-service 3000:80` → port 3000, mapping "→ svc/my-service:80"
- `kubectl port-forward deployment/app 9090:9090` → port 9090, mapping "→ deployment/app:9090"

**Output:**
```javascript
{
  port: 8080,
  protocol: 'TCP',
  localAddress: '127.0.0.1',
  state: 'LISTEN',
  pid: 7890,
  processName: 'kubectl',
  source: 'Kubernetes',
  type: 'forward',
  mapping: '→ pod/nginx:80',
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: 'pod/nginx:80'
}
```

**Availability:** If no kubectl port-forward processes found, return empty array (no error).

### Port Proxy Scanner (`main/portproxy-scanner.js`)

**Command (Windows/WSL):**
```powershell
powershell.exe -NoProfile -Command "netsh interface portproxy show all"
```

**Output format:**
```
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000
*               8080        172.28.176.1    8080
```

**Parsing:** Extract rows after the header, split into listen address/port and connect address/port.

**Output:**
```javascript
{
  port: 3000,
  protocol: 'TCP',
  localAddress: '0.0.0.0',
  state: 'FORWARD',
  pid: null,
  processName: 'netsh portproxy',
  source: 'PortProxy',
  type: 'forward',
  mapping: '→ 172.28.176.1:3000',
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: '172.28.176.1:3000'
}
```

### macOS Scanner (`main/macos-scanner.js`)

**Commands:**
```bash
lsof -iTCP -sTCP:LISTEN -nP -F pcnT    # TCP listening
lsof -iUDP -nP -F pcnT                  # UDP
```

**Parsing:** lsof `-F` format outputs field-per-line (p=PID, c=command, n=name, T=TCP info).

**Output:** Same shape as WSL/Windows entries but with `source: 'macOS'`.

## Scanner Orchestration

### Updated `scanPorts()` in `main/scanner.js`

```javascript
async function scanPorts() {
  const platform = getPlatform();
  const scanners = getScanners(platform);

  const results = await Promise.allSettled(
    scanners.map(scanner => scanner.scan())
  );

  const ports = [];
  const errors = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      ports.push(...result.value);
    } else {
      errors.push({
        source: scanners[i].name,
        message: result.reason?.message || `${scanners[i].name} scan failed`
      });
    }
  });

  return { ports, errors };
}
```

### Scanner Registry

```javascript
function getScanners(platform) {
  const scanners = [];

  // Base scanners per platform
  if (platform === 'wsl') {
    scanners.push({ name: 'WSL', scan: scanWSL });
    scanners.push({ name: 'Windows', scan: scanWindows });
    scanners.push({ name: 'PortProxy', scan: scanPortProxy });
  } else if (platform === 'windows') {
    scanners.push({ name: 'Windows', scan: scanWindows });
    scanners.push({ name: 'PortProxy', scan: scanPortProxy });
  } else if (platform === 'macos') {
    scanners.push({ name: 'macOS', scan: scanMacOS });
  } else if (platform === 'linux') {
    scanners.push({ name: 'Linux', scan: scanLinux });
  }

  // Universal scanners
  scanners.push({ name: 'Docker', scan: scanDocker });
  scanners.push({ name: 'SSH', scan: scanSSH });
  scanners.push({ name: 'Kubernetes', scan: scanKubernetes });

  return scanners;
}
```

## UI Changes

### Updated Table Columns

| # | Column | Sortable | Description |
|---|--------|----------|-------------|
| 1 | Port | Yes | Port number |
| 2 | Mapping | Yes | Forwarding target (e.g., "→ 4000") or "—" |
| 3 | Protocol | Yes | TCP or UDP |
| 4 | Local Address | Yes | Bound address |
| 5 | State | Yes | Connection state |
| 6 | PID | Yes | Process ID |
| 7 | Process | Yes | Process name or container name (image) |
| 8 | Source | Yes | Badge showing origin |
| 9 | Actions | No | Stop / Disconnect / Remove button |

### Source Filter (dynamic)

Populated at startup based on platform detection. Only shows sources relevant to the current OS.

### Type Filter (new dropdown)

- All Types
- Direct (entries where `type === 'listen'`)
- Forwarded (entries where `type === 'forward'`)

### Source Badges (visual)

Each source gets a distinct badge color:
- WSL: blue
- Windows: purple
- Docker: cyan
- SSH: yellow
- Kubernetes: green
- PortProxy: orange
- macOS: gray
- Linux: teal

### Process Column Display

- Regular processes: process name as before
- Docker: `containerName (containerImage)` — e.g., "my-app (nginx:latest)"
- SSH tunnels: "ssh" with tunnel target in mapping column
- kubectl: "kubectl" with target in mapping column
- PortProxy: "netsh portproxy"

### Actions Column

| Source | Button | Action |
|--------|--------|--------|
| WSL / Windows / Linux / macOS | Stop | kill -9 / Stop-Process |
| Docker | Stop Container | docker stop -t 10, then docker kill |
| SSH | Disconnect | kill -9 the SSH process |
| Kubernetes | Disconnect | kill -9 the kubectl process |
| PortProxy | Remove Rule | netsh interface portproxy delete |

### Confirmation Dialog Messages

- Regular: "Stop process `node` (PID 1234) on port 3000?"
- Docker: "Stop container `my-app` (nginx:latest) on port 3000?"
- SSH: "Disconnect SSH tunnel on port 3000 → remotehost:4000?"
- kubectl: "Disconnect port-forward on port 8080 → pod/nginx:80?"
- PortProxy: "Remove port proxy rule 0.0.0.0:3000 → 172.28.0.1:3000?"

## Process Management

### Extended Kill/Stop Handler

```typescript
interface KillRequest {
  pid: number | null;
  source: 'WSL' | 'Windows' | 'Linux' | 'macOS' | 'Docker' | 'SSH' | 'Kubernetes' | 'PortProxy';
  containerId?: string;
  portproxyRule?: { listenAddress: string; listenPort: number };
}
```

### Per-Source Strategy

| Source | Method | Timeout |
|--------|--------|---------|
| WSL / Linux / macOS | `kill -9 <pid>` | 5s |
| Windows | `powershell.exe Stop-Process -Id <pid> -Force` | 5s |
| Docker | `docker stop -t 10 <id>`, escalate to `docker kill <id>` | 15s |
| SSH | `kill -9 <pid>` | 5s |
| Kubernetes | `kill -9 <pid>` | 5s |
| PortProxy | `netsh interface portproxy delete v4tov4 listenport=X listenaddress=Y` | 5s |

### Docker Stop Flow

```javascript
async function stopContainer(containerId) {
  try {
    await execAsync(`docker stop -t 10 ${containerId}`, { timeout: 15000 });
    return { success: true };
  } catch (stopError) {
    try {
      await execAsync(`docker kill ${containerId}`, { timeout: 5000 });
      return { success: true };
    } catch (killError) {
      return { success: false, error: killError.message };
    }
  }
}
```

## Error Handling

### Graceful Degradation Rules

| Scenario | Behavior |
|----------|----------|
| Tool not installed (docker, kubectl) | Silent skip — empty results, no error |
| Tool exists but fails | ScanError produced, other scanners unaffected |
| Permission denied | ScanError with descriptive message |
| Scan timeout (5s per scanner) | Scanner killed, ScanError, previous data cleared |
| Docker daemon not running | Silent skip (detected via docker ps failure with specific exit code) |

**Key principle:** A missing tool is silence; a broken tool is a warning.

### Kill Error Handling

| Scenario | Behavior |
|----------|----------|
| Permission denied | Toast: "Cannot stop — insufficient permissions" |
| Container already stopped | Silent success |
| Process already gone | Silent success |
| Docker stop timeout → kill success | Report success |
| Docker stop timeout → kill fails | Toast: "Failed to stop container" |
| PortProxy delete fails | Toast: "Cannot remove rule — run as admin" |
| Invalid containerId/PID | Reject before execution |

## Security

- **Container ID validation:** Only hex characters, minimum 12 chars
- **PID validation:** Only positive integers (existing)
- **Port proxy validation:** Only numeric ports (1-65535) + valid IPv4 addresses
- **No shell injection:** All dynamic values validated with strict patterns before interpolation
- **Principle of least privilege:** No admin/sudo required for read-only scanning; kill actions may require elevated permissions and report clearly if denied

## IPC Contract Updates

### Updated Preload API

```typescript
interface PortManagerAPI {
  scanPorts(): Promise<{ ports: PortEntry[], errors: ScanError[] }>;
  killProcess(request: KillRequest): Promise<{ success: boolean, error?: string }>;
  getSettings(): Promise<Settings>;
  setSettings(partial: Partial<Settings>): Promise<Settings>;
  onSettingsChanged(callback: (settings: Settings) => void): void;
}
```

### Updated ScanError

```typescript
interface ScanError {
  source: 'WSL' | 'Windows' | 'Docker' | 'SSH' | 'Kubernetes' | 'PortProxy' | 'macOS' | 'Linux';
  message: string;
}
```

## File Structure (additions)

```
main/
├── scanner.js              # Orchestrator (updated: dynamic scanner registry)
├── platform.js             # NEW: Platform detection utilities
├── docker-scanner.js       # NEW: Docker container port scanning
├── ssh-scanner.js          # NEW: SSH tunnel detection
├── k8s-scanner.js          # NEW: kubectl port-forward detection
├── portproxy-scanner.js    # NEW: netsh portproxy rules
├── macos-scanner.js        # NEW: macOS lsof-based scanning
├── process-manager.js      # Updated: Docker stop, portproxy delete
├── ...
tests/
├── docker-scanner.test.js  # NEW
├── ssh-scanner.test.js     # NEW
├── k8s-scanner.test.js     # NEW
├── portproxy-scanner.test.js # NEW
├── macos-scanner.test.js   # NEW
├── platform.test.js        # NEW
├── ...
```

## Testing Strategy

### Unit Tests (new scanners)

- **docker-scanner.test.js:** Parse mock `docker ps` JSON with various port formats (single, range, UDP, no published ports, multiple containers)
- **ssh-scanner.test.js:** Parse mock /proc/cmdline content with -L, -R, -D flags, multiple forwards, edge cases
- **k8s-scanner.test.js:** Parse mock ps output with various kubectl port-forward patterns (pod, service, deployment, namespace)
- **portproxy-scanner.test.js:** Parse mock netsh output table format, empty table, IPv6 rules
- **macos-scanner.test.js:** Parse mock lsof -F output for TCP and UDP
- **platform.test.js:** Platform detection across environments

### Unit Tests (process-manager updates)

- Docker stop → kill escalation flow
- PortProxy rule deletion command construction
- Container ID format validation
- Port proxy rule validation

### Integration Tests

- `scanPorts` orchestrates all scanners, handles mixed success/failure
- Platform-based scanner selection
- Source and Type filters work correctly with new entry types
- Kill request routing to correct handler

### Manual Testing

- Start Docker containers with port mappings, verify they appear with correct mapping column
- Create SSH tunnel, verify detection and mapping display
- Start kubectl port-forward, verify detection
- Create netsh portproxy rule, verify detection
- Stop each type from UI, verify action completes
- Test on macOS and native Linux (if available)
