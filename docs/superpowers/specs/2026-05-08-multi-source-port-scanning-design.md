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
  proxyType: 'v4tov4' | 'v4tov6' | 'v6tov4' | 'v6tov6' | null;
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

### Default Values for Base/Legacy Entries

Entries from WSL, Windows, Linux, and macOS base scanners use these defaults for new fields:

```javascript
{
  type: 'listen',
  mapping: null,
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: null
}
```

### Action Button Enable Rules

The Stop/Disconnect button is **enabled** when at least one of these is true:
- `pid` is not null (regular processes, SSH, kubectl)
- `containerId` is not null (Docker containers)
- Source is `'PortProxy'` (rule can always be deleted using localAddress + port from the entry)

The button is **disabled** (greyed out) only when none of the above apply and no actionable identifier exists.

### PortProxy Action Data

PortProxy entries don't have a PID, so the renderer constructs the `KillRequest.portproxyRule` from entry fields:
- `listenAddress` → from `entry.localAddress`
- `listenPort` → from `entry.port`
- `proxyType` → stored in a new field `entry.proxyType` (only set for PortProxy entries, null otherwise)

Add to the data model:
```typescript
proxyType: 'v4tov4' | 'v4tov6' | 'v6tov4' | 'v6tov6' | null;  // Only set for PortProxy source
```

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

**Port range handling:** Ranges like `8000-8010->8000-8010/tcp` are expanded into individual entries (one row per port). Each row shows its specific mapping (e.g., port 8000, mapping "→ 8000"; port 8001, mapping "→ 8001"). This keeps the table granular and actionable — stopping the container affects all ports anyway.

**Multi-mapping / dual-stack:** A container can publish the same port on both IPv4 and IPv6 (e.g., `0.0.0.0:3000->4000/tcp, :::3000->4000/tcp`). The `Ports` field is comma-separated — split on `, ` first, then parse each mapping independently. Each produces its own row.

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

**Detection strategy — self-contained (no base scan dependency):**

The SSH scanner independently discovers SSH processes with port forwarding. It does NOT rely on output from the base scanner.

**Step 1 — Find SSH processes:**

Linux/WSL:
```bash
pgrep -a ssh
```
Returns PIDs and command snippets. Filter for processes that contain `-L`, `-R`, or `-D` flags.

macOS:
```bash
ps -eo pid,args | grep '[s]sh.*-[LRD]'
```

Windows (native):
```powershell
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json
```

**Step 2 — Read full command line:**

Linux/WSL: `/proc/<pid>/cmdline` (null-separated) for processes found in step 1.
macOS: Already have full args from `ps -eo pid,args`.
Windows: Already have `CommandLine` from Get-CimInstance.

**Parsing `-L` flags (local forward — in scope):**
- `-L 3000:localhost:4000` → port 3000, mapping "→ localhost:4000"
- `-L 3000:remotehost:4000` → port 3000, mapping "→ remotehost:4000"
- `-L [bind_address:]port:host:hostport` (full format)
- Multiple `-L` flags on one SSH command produce multiple entries (one row per forward)

**Parsing `-R` flags (remote forward — out of scope):**
- `-R` forwards do NOT create entries. The remote side listens, not the local machine. SSH doesn't bind a local port for `-R`, so there's nothing to show in the port table. (The local target service, if any, will already appear via the base scanner.)

**`-D` flag (SOCKS proxy — in scope):**
- `-D 1080` → port 1080, mapping "SOCKS proxy", type "forward"
- SOCKS proxies occupy a local port and are actionable (kill SSH process to close)

**Out of scope:** `-R` remote forwards (no local port bound), SSH connections without forwarding flags.

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

**Windows (native):**
```powershell
Get-CimInstance Win32_Process -Filter "Name='kubectl.exe' AND CommandLine LIKE '%port-forward%'" | Select-Object ProcessId,CommandLine | ConvertTo-Json
```

**Command parsing examples:**
- `kubectl port-forward pod/nginx 8080:80` → port 8080, mapping "→ pod/nginx:80"
- `kubectl port-forward svc/my-service 3000:80` → port 3000, mapping "→ svc/my-service:80"
- `kubectl port-forward deployment/app 9090:9090` → port 9090, mapping "→ deployment/app:9090"
- `kubectl port-forward pod/nginx 8080:80 9090:90` → two entries (one per port pair)

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

**Output format (includes all address families):**
```
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000
*               8080        172.28.176.1    8080

Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              9090        172.28.176.1    9090
```

**Parsing:** Extract rows after each header section. The `show all` command returns all rule types (v4tov4, v4tov6, v6tov4, v6tov6). The `*` listen address is normalized to `0.0.0.0` for IPv4 sections and `::` for IPv6 sections.

**Address family tracking:** Each entry records which proxy type it belongs to (v4tov4, v4tov6, v6tov4, v6tov6) so the correct `netsh interface portproxy delete` variant can be used for removal.

**KillRequest for PortProxy:**
```typescript
portproxyRule?: {
  listenAddress: string;
  listenPort: number;
  proxyType: 'v4tov4' | 'v4tov6' | 'v6tov4' | 'v6tov6';
}
```

**Delete command uses the correct variant:**
```
netsh interface portproxy delete <proxyType> listenport=X listenaddress=Y
```

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

**Security validation:** Listen addresses must be valid IPv4 (`*`, `0.0.0.0`, or dotted-quad) or IPv6 (`::`, or colon-hex format). Ports must be 1-65535.

### macOS Scanner (`main/macos-scanner.js`)

**Commands:**
```bash
lsof -iTCP -sTCP:LISTEN -nP -F pcn    # TCP listening
lsof -iUDP -nP -F pcn                  # UDP
```

**lsof `-F` output format (field-per-line):**
```
p1234          # PID
cnode          # command name
n*:3000        # name: *:port (listening on all interfaces)
n127.0.0.1:8080  # name: addr:port (listening on specific interface)
p5678
cnginx
n[::1]:80
```

**Parsing rules:**
- Lines starting with `p` → new PID context
- Lines starting with `c` → command/process name for current PID
- Lines starting with `n` → network name (address:port)
- Parse address and port from `n` field: split on last `:`, address is everything before, port is everything after
- `*` address normalized to `0.0.0.0`
- IPv6 addresses appear in brackets: `[::1]:80` → address `::1`, port `80`

**UDP handling:** Same parsing, but `state` is set to `*` (stateless) and no `-sTCP:LISTEN` filter applies.

**Failure cases:**
- `lsof` not found → ScanError (should never happen on macOS, but handle)
- Permission denied (non-root can't see all PIDs) → partial results returned, no error (lsof shows what it can)
- Malformed lines → skip and continue

**Output:** Same normalized PortEntry shape:
```javascript
{
  port: 3000,
  protocol: 'TCP',
  localAddress: '0.0.0.0',
  state: 'LISTEN',
  pid: 1234,
  processName: 'node',
  source: 'macOS',
  type: 'listen',
  mapping: null,
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: null
}
```

### Linux Scanner (`main/linux-scanner.js`)

The Linux scanner is functionally identical to the WSL scanner (uses `ss -tlnp` and `ss -ulnp`) but emits `source: 'Linux'` instead of `source: 'WSL'`. It reuses the same `parseSSOutput` and `parseSSLine` functions from the existing scanner module, with only the source label differing.

```javascript
async function scanLinux() {
  const [tcpResult, udpResult] = await Promise.all([
    execAsync('ss -tlnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS }),
    execAsync('ss -ulnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS })
  ]);

  return [
    ...parseSSOutput(tcpResult.stdout, 'TCP').map(e => ({ ...e, source: 'Linux' })),
    ...parseSSOutput(udpResult.stdout, 'UDP').map(e => ({ ...e, source: 'Linux' }))
  ];
}
```

## Scanner Orchestration

### Deduplication & Overlap Policy

A port can appear from multiple sources simultaneously. For example:
- Docker publishes port 3000 → appears in both the base scan (WSL/Windows/Linux) AND the Docker scanner
- An SSH tunnel on port 8080 → appears in both the base scan AND the SSH scanner
- A kubectl port-forward → appears in both the base scan AND the Kubernetes scanner

**Policy: Keep all rows, no merging.** Each source produces its own entries. The user can see that port 3000 shows up as both a "WSL" listen and a "Docker" forward — this is accurate and informative. The Source and Type filters let users isolate what they care about.

**Rationale:** Merging would lose information (is it a Docker port? an SSH tunnel? both?) and make the code significantly more complex for unclear UX benefit. Showing separate rows with distinct source badges is clear and truthful.

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

### Search Scope

The search bar filters across: port number, process name, local address, mapping text, container name, container image, and tunnel target. All text-based fields are included so users can search "nginx" and find both regular nginx processes and Docker containers running nginx.

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
- Docker: "Stop container `my-app` (nginx:latest)? This will close ports 3000, 4000, 8080."
- SSH: "Disconnect SSH tunnel (PID 5678)? This will close ports 3000, 8080." (lists all forwards from same SSH process)
- kubectl: "Disconnect port-forward (PID 7890)? This will close ports 8080, 9090." (lists all forwards from same kubectl process)
- PortProxy: "Remove port proxy rule 0.0.0.0:3000 → 172.28.0.1:3000?"

**Sibling row awareness:** When a Docker container or SSH/kubectl process has multiple port entries, the confirmation dialog lists ALL affected ports so the user knows that stopping one entry removes sibling rows too. After the action, an immediate rescan will naturally remove all related rows.

## Process Management

### Extended Kill/Stop Handler

```typescript
interface KillRequest {
  pid: number | null;
  source: 'WSL' | 'Windows' | 'Linux' | 'macOS' | 'Docker' | 'SSH' | 'Kubernetes' | 'PortProxy';
  containerId?: string;
  portproxyRule?: { listenAddress: string; listenPort: number; proxyType: 'v4tov4' | 'v4tov6' | 'v6tov4' | 'v6tov6' };
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
| PortProxy | `netsh interface portproxy delete <proxyType> listenport=X listenaddress=Y` | 5s |

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
| Permission denied (scan fails entirely) | ScanError with descriptive message |
| Permission limited (partial results) | Return available results, no error (applies to macOS lsof and Linux ss without root) |
| Scan timeout (5s per scanner) | Scanner killed, ScanError, previous data cleared |
| Docker daemon not running | Silent skip (detected via docker ps failure with specific exit code) |

**Key principle:** A missing tool is silence; a broken tool is a warning; a tool with limited permissions returns what it can without complaining.

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
- **Port proxy validation:** Only numeric ports (1-65535) + valid IPv4 addresses or IPv6 addresses (colon-hex format)
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
├── linux-scanner.js        # NEW: Native Linux ss-based scanning (reuses parseSSOutput)
├── process-manager.js      # Updated: Docker stop, portproxy delete
├── ...
tests/
├── docker-scanner.test.js  # NEW
├── ssh-scanner.test.js     # NEW
├── k8s-scanner.test.js     # NEW
├── portproxy-scanner.test.js # NEW
├── macos-scanner.test.js   # NEW
├── linux-scanner.test.js   # NEW
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
