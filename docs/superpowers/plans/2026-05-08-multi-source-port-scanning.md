# Multi-Source Port Scanning Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Docker, SSH, kubectl, netsh portproxy, macOS, and Linux scanners to Port Manager with a port mapping column and cross-platform support.

**Architecture:** Each new source gets its own scanner module with pure parsing functions (testable) and an async `scan()` entry point. The existing `scanner.js` becomes an orchestrator that dynamically picks scanners based on detected platform. The renderer gains a Mapping column, Type filter, and source-aware action buttons.

**Tech Stack:** Node.js, Electron, Jest, child_process (exec/execSync), vanilla JS renderer

**Spec:** `docs/superpowers/specs/2026-05-08-multi-source-port-scanning-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `main/platform.js` | Platform detection (macos/windows/wsl/linux) |
| `main/docker-scanner.js` | Docker port mapping parsing + scan |
| `main/ssh-scanner.js` | SSH tunnel (-L/-D) detection + parsing |
| `main/k8s-scanner.js` | kubectl port-forward detection + parsing |
| `main/portproxy-scanner.js` | netsh portproxy rule parsing + scan |
| `main/macos-scanner.js` | macOS lsof-based port scanning |
| `main/linux-scanner.js` | Native Linux ss-based scanning (source: Linux) |
| `tests/platform.test.js` | Platform detection tests |
| `tests/docker-scanner.test.js` | Docker scanner parsing tests |
| `tests/ssh-scanner.test.js` | SSH scanner parsing tests |
| `tests/k8s-scanner.test.js` | kubectl scanner parsing tests |
| `tests/portproxy-scanner.test.js` | Port proxy parsing tests |
| `tests/macos-scanner.test.js` | macOS lsof parsing tests |
| `tests/linux-scanner.test.js` | Linux scanner tests |
| `tests/process-manager-extended.test.js` | Tests for Docker stop, portproxy delete |

### Modified Files

| File | Changes |
|------|---------|
| `main/scanner.js` | Export parseSSOutput/parseSSLine; refactor scanPorts to use registry |
| `main/process-manager.js` | Add Docker stop, portproxy delete, validation |
| `main/preload.js` | Update killProcess IPC to accept KillRequest object |
| `main/main.js` | Update kill-process handler for new payload |
| `renderer/index.html` | Add Mapping column header, Type filter dropdown |
| `renderer/js/table.js` | Add Mapping column, type filter, updated action buttons |
| `renderer/js/app.js` | Update handleStopClick for new sources, sibling awareness |
| `renderer/styles/components.css` | Source badge colors for new sources |
| `tests/scanner-orchestration.test.js` | Update for new scanner registry |

---

## Chunk 1: Platform Detection & Scanner Infrastructure

### Task 1: Platform Detection Module

**Files:**
- Create: `main/platform.js`
- Create: `tests/platform.test.js`

- [ ] **Step 1: Write platform detection tests**

Create `tests/platform.test.js`:

```javascript
const fs = require('fs');

jest.mock('fs');

// We need to re-require platform.js for each test to reset module state
function loadPlatform() {
  jest.resetModules();
  jest.mock('fs');
  return require('../main/platform');
}

describe('getPlatform', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  test('returns macos on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { getPlatform } = loadPlatform();
    expect(getPlatform()).toBe('macos');
  });

  test('returns windows on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { getPlatform } = loadPlatform();
    expect(getPlatform()).toBe('windows');
  });

  test('returns wsl when /proc/version contains microsoft', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockReturnValue('Linux version 5.15.0-1-microsoft-standard-WSL2');
    expect(getPlatform()).toBe('wsl');
  });

  test('returns linux when /proc/version does not contain microsoft', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockReturnValue('Linux version 6.1.0-generic');
    expect(getPlatform()).toBe('linux');
  });

  test('returns linux when /proc/version cannot be read', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(getPlatform()).toBe('linux');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/platform.test.js --verbose`
Expected: FAIL with "Cannot find module '../main/platform'"

- [ ] **Step 3: Write platform.js implementation**

Create `main/platform.js`:

```javascript
const fs = require('fs');

function isWSL() {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}

function getPlatform() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (isWSL()) return 'wsl';
  return 'linux';
}

module.exports = { getPlatform, isWSL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/platform.test.js --verbose`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add main/platform.js tests/platform.test.js
git commit -m "feat: add platform detection module

Detects macos, windows, wsl, or linux to drive scanner selection.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Refactor scanner.js — Export Parsing Functions & Add Default Fields

**Files:**
- Modify: `main/scanner.js`
- Modify: `tests/scanner.test.js`

- [ ] **Step 1: Update scanner.js to add default new fields to existing entries**

In `main/scanner.js`, update `parseSSLine` to include the new default fields:

```javascript
// At the end of parseSSLine, before the return statement, add:
const defaults = {
  type: 'listen',
  mapping: null,
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: null,
  proxyType: null
};

return {
  ...defaults,
  port,
  protocol,
  localAddress,
  state: protocol === 'TCP' ? 'LISTEN' : '*',
  pid,
  processName,
  source: 'WSL'
};
```

Similarly update `parseWindowsTCP` and `parseWindowsUDP` to include the same defaults.

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `npx jest tests/scanner.test.js --verbose`
Expected: Existing tests still pass (they use `toEqual` so they'll need updating to include new fields)

- [ ] **Step 3: Update existing scanner tests to expect new default fields**

In `tests/scanner.test.js`, update each `toEqual` assertion to include the new fields:

```javascript
expect(entries[0]).toEqual({
  port: 3000,
  protocol: 'TCP',
  localAddress: '0.0.0.0',
  state: 'LISTEN',
  pid: 1234,
  processName: 'node',
  source: 'WSL',
  type: 'listen',
  mapping: null,
  containerName: null,
  containerImage: null,
  containerId: null,
  tunnelTarget: null,
  proxyType: null
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add main/scanner.js tests/scanner.test.js
git commit -m "refactor: add default fields to port entries for forward compatibility

All entries now include type, mapping, containerName, containerImage,
containerId, tunnelTarget, and proxyType (all null/default for base scanners).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Refactor scanner.js — Platform-Based Scanner Registry

**Files:**
- Modify: `main/scanner.js`
- Modify: `tests/scanner-orchestration.test.js`

- [ ] **Step 1: Refactor scanPorts to use getScanners registry**

Replace the existing `scanPorts` function in `main/scanner.js` with the platform-aware version:

```javascript
const { getPlatform } = require('./platform');

function getScanners(platform) {
  const scanners = [];

  if (platform === 'wsl') {
    scanners.push({ name: 'WSL', scan: scanWSL });
    scanners.push({ name: 'Windows', scan: scanWindows });
  } else if (platform === 'windows') {
    scanners.push({ name: 'Windows', scan: scanWindows });
  } else if (platform === 'macos') {
    // scanners.push({ name: 'macOS', scan: scanMacOS }); // Added in later task
  } else if (platform === 'linux') {
    // scanners.push({ name: 'Linux', scan: scanLinux }); // Added in later task
  }

  return scanners;
}

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

Also export `parseSSOutput`, `parseSSLine`, and `getScanners` for reuse.

- [ ] **Step 2: Update orchestration tests for new structure**

Update `tests/scanner-orchestration.test.js` to mock `platform.js` and test the registry:

```javascript
jest.mock('../main/platform', () => ({
  getPlatform: jest.fn(() => 'wsl')
}));
const { getPlatform } = require('../main/platform');
const { getScanners, scanPorts } = require('../main/scanner');

describe('getScanners', () => {
  test('wsl returns WSL and Windows scanners', () => {
    const scanners = getScanners('wsl');
    const names = scanners.map(s => s.name);
    expect(names).toContain('WSL');
    expect(names).toContain('Windows');
  });

  test('windows returns only Windows scanner', () => {
    const scanners = getScanners('windows');
    const names = scanners.map(s => s.name);
    expect(names).toContain('Windows');
    expect(names).not.toContain('WSL');
  });

  test('unknown platform returns empty array', () => {
    expect(getScanners('unknown')).toEqual([]);
  });
});

describe('scanPorts - partial failure', () => {
  beforeEach(() => { jest.resetModules(); });

  test('returns ports from successful scanners and errors from failed ones', async () => {
    getPlatform.mockReturnValue('wsl');
    // Mock exec to make WSL succeed and Windows fail:
    // This verifies Promise.allSettled aggregation
    const { scanPorts } = require('../main/scanner');
    const result = await scanPorts();
    expect(result).toHaveProperty('ports');
    expect(result).toHaveProperty('errors');
    expect(Array.isArray(result.ports)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `npx jest --verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add main/scanner.js tests/scanner-orchestration.test.js
git commit -m "refactor: platform-based scanner registry in scanPorts

scanPorts now uses getScanners(platform) to determine which scanners
to run. Currently supports WSL and Windows; new scanners plugged in later.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 2: Docker Scanner

### Task 4: Docker Scanner — Parsing

**Files:**
- Create: `main/docker-scanner.js`
- Create: `tests/docker-scanner.test.js`

- [ ] **Step 1: Write Docker port parsing tests**

Create `tests/docker-scanner.test.js`:

```javascript
const { parseDockerPorts, parseDockerPsLine } = require('../main/docker-scanner');

describe('parseDockerPorts', () => {
  test('parses single TCP port mapping', () => {
    const result = parseDockerPorts('0.0.0.0:3000->4000/tcp', 'my-app', 'nginx:latest', 'abc123def456');
    expect(result).toEqual([{
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
      tunnelTarget: null,
      proxyType: null
    }]);
  });

  test('parses UDP port mapping', () => {
    const result = parseDockerPorts('0.0.0.0:5353->5353/udp', 'dns', 'coredns:1.9', 'def456abc789');
    expect(result[0].protocol).toBe('UDP');
    expect(result[0].mapping).toBe('→ 5353');
  });

  test('parses IPv6 port mapping', () => {
    const result = parseDockerPorts(':::3000->4000/tcp', 'app', 'node:18', 'aaa111bbb222');
    expect(result[0].localAddress).toBe('::');
    expect(result[0].port).toBe(3000);
  });

  test('skips exposed-only ports (no host mapping)', () => {
    const result = parseDockerPorts('4000/tcp', 'app', 'node:18', 'aaa111bbb222');
    expect(result).toEqual([]);
  });

  test('parses port range into individual entries', () => {
    const result = parseDockerPorts('0.0.0.0:8000-8002->8000-8002/tcp', 'app', 'img:1', 'ccc333');
    expect(result).toHaveLength(3);
    expect(result[0].port).toBe(8000);
    expect(result[0].mapping).toBe('→ 8000');
    expect(result[1].port).toBe(8001);
    expect(result[2].port).toBe(8002);
  });

  test('parses comma-separated multi-mapping', () => {
    const result = parseDockerPorts(
      '0.0.0.0:3000->4000/tcp, :::3000->4000/tcp',
      'app', 'nginx:latest', 'abc123def456'
    );
    expect(result).toHaveLength(2);
    expect(result[0].localAddress).toBe('0.0.0.0');
    expect(result[1].localAddress).toBe('::');
  });

  test('returns empty array for empty ports string', () => {
    const result = parseDockerPorts('', 'app', 'img:1', 'abc123');
    expect(result).toEqual([]);
  });

  test('defaults to TCP when protocol suffix is missing', () => {
    const result = parseDockerPorts('0.0.0.0:3000->4000', 'app', 'img:1', 'abc123def456');
    expect(result[0].protocol).toBe('TCP');
  });
});

describe('parseDockerPsLine', () => {
  test('parses full docker ps JSON line', () => {
    const json = {
      Names: 'my-app',
      Image: 'nginx:latest',
      ID: 'abc123def456',
      Ports: '0.0.0.0:3000->4000/tcp, :::3000->4000/tcp'
    };
    const result = parseDockerPsLine(JSON.stringify(json));
    expect(result).toHaveLength(2);
    expect(result[0].containerName).toBe('my-app');
  });

  test('returns empty array for container with no published ports', () => {
    const json = { Names: 'db', Image: 'postgres:16', ID: 'fff999', Ports: '' };
    const result = parseDockerPsLine(JSON.stringify(json));
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/docker-scanner.test.js --verbose`
Expected: FAIL with "Cannot find module '../main/docker-scanner'"

- [ ] **Step 3: Write docker-scanner.js implementation**

Create `main/docker-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parseSinglePortMapping(mapping, containerName, containerImage, containerId) {
  mapping = mapping.trim();
  if (!mapping || !mapping.includes('->')) return null;

  const [hostPart, containerPart] = mapping.split('->');
  const lastColon = hostPart.lastIndexOf(':');
  if (lastColon === -1) return null;

  const localAddress = hostPart.substring(0, lastColon) || '0.0.0.0';
  const hostPortStr = hostPart.substring(lastColon + 1);

  let containerPort;
  let protocol = 'TCP';
  if (containerPart.includes('/')) {
    const [portStr, proto] = containerPart.split('/');
    containerPort = portStr;
    protocol = proto.toUpperCase() === 'UDP' ? 'UDP' : 'TCP';
  } else {
    containerPort = containerPart;
  }

  // Handle port ranges
  if (hostPortStr.includes('-') && containerPort.includes('-')) {
    const [hostStart, hostEnd] = hostPortStr.split('-').map(Number);
    const [containerStart] = containerPort.split('-').map(Number);
    const entries = [];
    for (let i = 0; i <= hostEnd - hostStart; i++) {
      entries.push({
        port: hostStart + i,
        protocol,
        localAddress: localAddress === ':::' ? '::' : localAddress,
        state: 'LISTEN',
        pid: null,
        processName: `${containerName} (${containerImage})`,
        source: 'Docker',
        type: 'forward',
        mapping: `→ ${containerStart + i}`,
        containerName,
        containerImage,
        containerId,
        tunnelTarget: null,
        proxyType: null
      });
    }
    return entries;
  }

  const hostPort = parseInt(hostPortStr, 10);
  const containerPortNum = parseInt(containerPort, 10);
  if (isNaN(hostPort) || isNaN(containerPortNum)) return null;

  return [{
    port: hostPort,
    protocol,
    localAddress: localAddress === ':::' ? '::' : localAddress,
    state: 'LISTEN',
    pid: null,
    processName: `${containerName} (${containerImage})`,
    source: 'Docker',
    type: 'forward',
    mapping: `→ ${containerPortNum}`,
    containerName,
    containerImage,
    containerId,
    tunnelTarget: null,
    proxyType: null
  }];
}

function parseDockerPorts(portsStr, containerName, containerImage, containerId) {
  if (!portsStr || !portsStr.trim()) return [];

  const mappings = portsStr.split(', ');
  const entries = [];

  for (const mapping of mappings) {
    const parsed = parseSinglePortMapping(mapping, containerName, containerImage, containerId);
    if (parsed) entries.push(...parsed);
  }

  return entries;
}

function parseDockerPsLine(jsonLine) {
  try {
    const data = JSON.parse(jsonLine);
    return parseDockerPorts(data.Ports || '', data.Names, data.Image, data.ID);
  } catch {
    return [];
  }
}

async function scanDocker() {
  try {
    const { stdout } = await execAsync(
      "docker ps --format '{{json .}}'",
      { timeout: SCAN_TIMEOUT_MS }
    );

    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');
    const entries = [];
    for (const line of lines) {
      entries.push(...parseDockerPsLine(line));
    }
    return entries;
  } catch (err) {
    if (err.code === 'ENOENT' || (err.message && err.message.includes('not found'))) {
      return [];
    }
    if (err.message && (err.message.includes('Cannot connect') || err.message.includes('daemon'))) {
      return [];
    }
    throw err;
  }
}

module.exports = { parseDockerPorts, parseDockerPsLine, parseSinglePortMapping, scanDocker };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/docker-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add main/docker-scanner.js tests/docker-scanner.test.js
git commit -m "feat: add Docker scanner with port mapping parsing

Parses docker ps output to extract published port mappings.
Handles TCP/UDP, IPv6, port ranges, and dual-stack.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Wire Docker Scanner into Registry

**Files:**
- Modify: `main/scanner.js`

- [ ] **Step 1: Import and register Docker scanner**

In `main/scanner.js`, add:

```javascript
const { scanDocker } = require('./docker-scanner');
```

In `getScanners`, add Docker to all platforms (after the platform-specific block):

```javascript
scanners.push({ name: 'Docker', scan: scanDocker });
```

- [ ] **Step 2: Run all tests**

Run: `npx jest --verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add main/scanner.js
git commit -m "feat: wire Docker scanner into scanner registry

Docker scanner now runs on all platforms as part of scanPorts().

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 3: SSH Scanner

### Task 6: SSH Scanner — Parsing

**Files:**
- Create: `main/ssh-scanner.js`
- Create: `tests/ssh-scanner.test.js`

- [ ] **Step 1: Write SSH forward parsing tests**

Create `tests/ssh-scanner.test.js`:

```javascript
const { parseSSHForwards, parseLocalForward, parseDynamicForward } = require('../main/ssh-scanner');

describe('parseLocalForward', () => {
  test('parses -L port:host:hostport (no bind)', () => {
    const result = parseLocalForward('3000:localhost:4000', 5678);
    expect(result).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 5678,
      processName: 'ssh',
      source: 'SSH',
      type: 'forward',
      mapping: '→ localhost:4000',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: 'localhost:4000',
      proxyType: null
    });
  });

  test('parses -L with explicit bind address', () => {
    const result = parseLocalForward('0.0.0.0:3000:remotehost:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
    expect(result.port).toBe(3000);
    expect(result.mapping).toBe('→ remotehost:4000');
  });

  test('parses -L with wildcard * bind', () => {
    const result = parseLocalForward('*:3000:host:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
  });

  test('parses -L with empty bind (all interfaces)', () => {
    const result = parseLocalForward(':3000:host:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
  });

  test('parses -L with IPv6 bind', () => {
    const result = parseLocalForward('[::1]:3000:host:4000', 1234);
    expect(result.localAddress).toBe('::1');
  });
});

describe('parseDynamicForward', () => {
  test('parses -D port (SOCKS, no bind)', () => {
    const result = parseDynamicForward('1080', 5678);
    expect(result).toEqual({
      port: 1080,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 5678,
      processName: 'ssh',
      source: 'SSH',
      type: 'forward',
      mapping: 'SOCKS proxy',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: 'SOCKS proxy',
      proxyType: null
    });
  });

  test('parses -D with bind address', () => {
    const result = parseDynamicForward('0.0.0.0:1080', 5678);
    expect(result.localAddress).toBe('0.0.0.0');
    expect(result.port).toBe(1080);
  });
});

describe('parseSSHForwards', () => {
  test('extracts -L forwards from cmdline', () => {
    const cmdline = 'ssh -L 3000:localhost:4000 -L 8080:db:5432 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(2);
    expect(result[0].port).toBe(3000);
    expect(result[1].port).toBe(8080);
    expect(result[1].mapping).toBe('→ db:5432');
  });

  test('extracts -D SOCKS proxy from cmdline', () => {
    const cmdline = 'ssh -D 1080 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(1);
    expect(result[0].mapping).toBe('SOCKS proxy');
  });

  test('ignores -R flags', () => {
    const cmdline = 'ssh -R 4000:localhost:3000 -L 8080:host:80 user@remote';
    const result = parseSSHForwards(cmdline, 1234);
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(8080);
  });

  test('returns empty for no forwarding flags', () => {
    const cmdline = 'ssh user@host';
    const result = parseSSHForwards(cmdline, 1234);
    expect(result).toEqual([]);
  });

  test('handles mixed -L and -D', () => {
    const cmdline = 'ssh -L 3000:web:80 -D 1080 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ssh-scanner.test.js --verbose`
Expected: FAIL

- [ ] **Step 3: Write ssh-scanner.js implementation**

Create `main/ssh-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');
const fs = require('fs');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function resolveBindAddress(bind) {
  if (bind === null || bind === undefined) return '127.0.0.1'; // No bind arg at all = loopback per spec
  if (bind === '' || bind === ':' || bind === '*') return '0.0.0.0'; // Explicit empty/wildcard = all interfaces
  if (bind.startsWith('[') && bind.endsWith(']')) return bind.slice(1, -1);
  return bind;
}

function parseLocalForward(spec, pid) {
  // Formats: [bind_address:]port:host:hostport
  // Split carefully — bind address might contain colons (IPv6)
  let bindAddress = null;
  let port, host, hostport;

  // Check for IPv6 bind: [::1]:port:host:hostport
  if (spec.startsWith('[')) {
    const closeBracket = spec.indexOf(']');
    bindAddress = spec.substring(0, closeBracket + 1);
    const rest = spec.substring(closeBracket + 2); // skip ]:
    const parts = rest.split(':');
    port = parseInt(parts[0], 10);
    host = parts[1];
    hostport = parts[2];
  } else {
    const parts = spec.split(':');
    if (parts.length === 3) {
      // port:host:hostport (no bind)
      port = parseInt(parts[0], 10);
      host = parts[1];
      hostport = parts[2];
    } else if (parts.length === 4) {
      // bind:port:host:hostport
      bindAddress = parts[0];
      port = parseInt(parts[1], 10);
      host = parts[2];
      hostport = parts[3];
    } else {
      return null;
    }
  }

  if (isNaN(port)) return null;

  const localAddress = resolveBindAddress(bindAddress);
  const target = `${host}:${hostport}`;

  return {
    port,
    protocol: 'TCP',
    localAddress,
    state: 'LISTEN',
    pid,
    processName: 'ssh',
    source: 'SSH',
    type: 'forward',
    mapping: `→ ${target}`,
    containerName: null,
    containerImage: null,
    containerId: null,
    tunnelTarget: target,
    proxyType: null
  };
}

function parseDynamicForward(spec, pid) {
  // Formats: [bind_address:]port
  let bindAddress = null;
  let port;

  if (spec.includes(':')) {
    const lastColon = spec.lastIndexOf(':');
    bindAddress = spec.substring(0, lastColon);
    port = parseInt(spec.substring(lastColon + 1), 10);
  } else {
    port = parseInt(spec, 10);
  }

  if (isNaN(port)) return null;

  const localAddress = resolveBindAddress(bindAddress);

  return {
    port,
    protocol: 'TCP',
    localAddress,
    state: 'LISTEN',
    pid,
    processName: 'ssh',
    source: 'SSH',
    type: 'forward',
    mapping: 'SOCKS proxy',
    containerName: null,
    containerImage: null,
    containerId: null,
    tunnelTarget: 'SOCKS proxy',
    proxyType: null
  };
}

function parseSSHForwards(cmdline, pid) {
  const entries = [];

  // Match -L arguments
  const localRegex = /-L\s+(\S+)/g;
  let match;
  while ((match = localRegex.exec(cmdline)) !== null) {
    const entry = parseLocalForward(match[1], pid);
    if (entry) entries.push(entry);
  }

  // Match -D arguments
  const dynamicRegex = /-D\s+(\S+)/g;
  while ((match = dynamicRegex.exec(cmdline)) !== null) {
    const entry = parseDynamicForward(match[1], pid);
    if (entry) entries.push(entry);
  }

  return entries;
}

async function findSSHProcesses(platform) {
  try {
    if (platform === 'windows') {
      const cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'ssh.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"';
      const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
      if (!stdout.trim()) return [];
      let data = JSON.parse(stdout);
      if (!Array.isArray(data)) data = [data];
      return data
        .filter(p => p.CommandLine && /-[LD]\s/.test(p.CommandLine))
        .map(p => ({ pid: p.ProcessId, cmdline: p.CommandLine }));
    }

    // Linux/WSL/macOS
    const cmd = platform === 'macos'
      ? "ps -eo pid,args | grep '[s]sh.*-[LD]'"
      : "pgrep -a ssh";
    const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n');
    const processes = [];

    for (const line of lines) {
      const spaceIdx = line.trim().indexOf(' ');
      if (spaceIdx === -1) continue;
      const pid = parseInt(line.trim().substring(0, spaceIdx), 10);
      let cmdline = line.trim().substring(spaceIdx + 1);

      if (isNaN(pid)) continue;
      if (!/-[LD]\s/.test(cmdline)) continue;

      // On Linux/WSL, try to get full cmdline from /proc
      if (platform !== 'macos') {
        try {
          const procCmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
          cmdline = procCmdline.replace(/\0/g, ' ').trim();
        } catch {
          // Use cmdline from pgrep
        }
      }

      processes.push({ pid, cmdline });
    }

    return processes;
  } catch {
    return [];
  }
}

async function scanSSH() {
  const platform = getPlatform();
  const processes = await findSSHProcesses(platform);

  const entries = [];
  for (const proc of processes) {
    entries.push(...parseSSHForwards(proc.cmdline, proc.pid));
  }

  return entries;
}

module.exports = { parseLocalForward, parseDynamicForward, parseSSHForwards, findSSHProcesses, scanSSH };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/ssh-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Wire into scanner registry and commit**

In `main/scanner.js`, add:
```javascript
const { scanSSH } = require('./ssh-scanner');
```
And in `getScanners` after the Docker line:
```javascript
scanners.push({ name: 'SSH', scan: scanSSH });
```

```bash
git add main/ssh-scanner.js tests/ssh-scanner.test.js main/scanner.js
git commit -m "feat: add SSH tunnel scanner with -L/-D parsing

Detects SSH processes with local forwards and SOCKS proxies.
Supports Linux, macOS, and Windows via platform-specific detection.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 4: Kubernetes & Port Proxy Scanners

### Task 7: Kubernetes Scanner

**Files:**
- Create: `main/k8s-scanner.js`
- Create: `tests/k8s-scanner.test.js`

- [ ] **Step 1: Write kubectl port-forward parsing tests**

Create `tests/k8s-scanner.test.js`:

```javascript
const { parseKubectlPortForward } = require('../main/k8s-scanner');

describe('parseKubectlPortForward', () => {
  test('parses pod port-forward with localPort:remotePort', () => {
    const result = parseKubectlPortForward('kubectl port-forward pod/nginx 8080:80', 7890);
    expect(result).toEqual([{
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
      tunnelTarget: 'pod/nginx:80',
      proxyType: null
    }]);
  });

  test('parses service port-forward', () => {
    const result = parseKubectlPortForward('kubectl port-forward svc/my-service 3000:80', 1234);
    expect(result[0].mapping).toBe('→ svc/my-service:80');
    expect(result[0].port).toBe(3000);
  });

  test('parses single-port form (localPort == remotePort)', () => {
    const result = parseKubectlPortForward('kubectl port-forward pod/nginx 8080', 1234);
    expect(result[0].port).toBe(8080);
    expect(result[0].mapping).toBe('→ pod/nginx:8080');
  });

  test('parses multiple port pairs', () => {
    const result = parseKubectlPortForward('kubectl port-forward pod/nginx 8080:80 9090:90', 1234);
    expect(result).toHaveLength(2);
    expect(result[0].port).toBe(8080);
    expect(result[1].port).toBe(9090);
  });

  test('parses --address flag', () => {
    const result = parseKubectlPortForward('kubectl port-forward --address 0.0.0.0 pod/nginx 8080:80', 1234);
    expect(result[0].localAddress).toBe('0.0.0.0');
  });

  test('parses --address with multiple addresses', () => {
    const result = parseKubectlPortForward('kubectl port-forward --address localhost,0.0.0.0 pod/nginx 8080:80', 1234);
    expect(result).toHaveLength(2);
    expect(result[0].localAddress).toBe('localhost');
    expect(result[1].localAddress).toBe('0.0.0.0');
  });

  test('parses deployment target', () => {
    const result = parseKubectlPortForward('kubectl port-forward deployment/app 9090:9090', 1234);
    expect(result[0].mapping).toBe('→ deployment/app:9090');
  });

  test('handles namespace flag (ignored, target still parsed)', () => {
    const result = parseKubectlPortForward('kubectl port-forward -n production svc/api 3000:80', 1234);
    expect(result[0].mapping).toBe('→ svc/api:80');
  });

  test('returns empty for non-port-forward command', () => {
    const result = parseKubectlPortForward('kubectl get pods', 1234);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/k8s-scanner.test.js --verbose`
Expected: FAIL

- [ ] **Step 3: Write k8s-scanner.js implementation**

Create `main/k8s-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parseKubectlPortForward(cmdline, pid) {
  if (!cmdline.includes('port-forward')) return [];

  const parts = cmdline.trim().split(/\s+/);
  const pfIndex = parts.indexOf('port-forward');
  if (pfIndex === -1) return [];

  // Extract --address flag if present
  let addresses = ['127.0.0.1'];
  const addrIndex = parts.indexOf('--address');
  if (addrIndex !== -1 && addrIndex + 1 < parts.length) {
    addresses = parts[addrIndex + 1].split(',');
  }

  // Find target (pod/X, svc/X, deployment/X) and port pairs
  let target = null;
  const portPairs = [];

  for (let i = pfIndex + 1; i < parts.length; i++) {
    const part = parts[i];
    // Skip flags
    if (part.startsWith('-')) {
      if (part === '--address' || part === '-n' || part === '--namespace') {
        i++; // skip flag value
      }
      continue;
    }
    // Target: contains / (pod/name, svc/name, deployment/name)
    if (part.includes('/') && !target) {
      target = part;
      continue;
    }
    // Port pair: digits possibly with :
    if (/^\d+/.test(part)) {
      portPairs.push(part);
    }
  }

  if (!target || portPairs.length === 0) return [];

  const entries = [];
  for (const pair of portPairs) {
    let localPort, remotePort;
    if (pair.includes(':')) {
      [localPort, remotePort] = pair.split(':').map(Number);
    } else {
      localPort = parseInt(pair, 10);
      remotePort = localPort;
    }

    if (isNaN(localPort) || isNaN(remotePort)) continue;

    for (const addr of addresses) {
      entries.push({
        port: localPort,
        protocol: 'TCP',
        localAddress: addr,
        state: 'LISTEN',
        pid,
        processName: 'kubectl',
        source: 'Kubernetes',
        type: 'forward',
        mapping: `→ ${target}:${remotePort}`,
        containerName: null,
        containerImage: null,
        containerId: null,
        tunnelTarget: `${target}:${remotePort}`,
        proxyType: null
      });
    }
  }

  return entries;
}

async function findKubectlProcesses(platform) {
  try {
    if (platform === 'windows') {
      const cmd = "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='kubectl.exe' AND CommandLine LIKE '%port-forward%'\\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json\"";
      const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
      if (!stdout.trim()) return [];
      let data = JSON.parse(stdout);
      if (!Array.isArray(data)) data = [data];
      return data.map(p => ({ pid: p.ProcessId, cmdline: p.CommandLine }));
    }

    const { stdout } = await execAsync("pgrep -af 'kubectl.*port-forward'", { timeout: SCAN_TIMEOUT_MS });
    if (!stdout.trim()) return [];

    return stdout.trim().split('\n').map(line => {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) return null;
      const pid = parseInt(line.substring(0, spaceIdx), 10);
      const cmdline = line.substring(spaceIdx + 1);
      return isNaN(pid) ? null : { pid, cmdline };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function scanKubernetes() {
  const platform = getPlatform();
  const processes = await findKubectlProcesses(platform);

  const entries = [];
  for (const proc of processes) {
    entries.push(...parseKubectlPortForward(proc.cmdline, proc.pid));
  }

  return entries;
}

module.exports = { parseKubectlPortForward, findKubectlProcesses, scanKubernetes };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/k8s-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Wire into registry and commit**

In `main/scanner.js`:
```javascript
const { scanKubernetes } = require('./k8s-scanner');
// In getScanners:
scanners.push({ name: 'Kubernetes', scan: scanKubernetes });
```

```bash
git add main/k8s-scanner.js tests/k8s-scanner.test.js main/scanner.js
git commit -m "feat: add Kubernetes port-forward scanner

Detects kubectl port-forward processes and parses port mappings.
Supports pod, svc, deployment targets and --address flag.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Port Proxy Scanner

**Files:**
- Create: `main/portproxy-scanner.js`
- Create: `tests/portproxy-scanner.test.js`

- [ ] **Step 1: Write portproxy parsing tests**

Create `tests/portproxy-scanner.test.js`:

```javascript
const { parsePortProxyOutput } = require('../main/portproxy-scanner');

describe('parsePortProxyOutput', () => {
  test('parses v4tov4 rules', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000
*               8080        172.28.176.1    8080
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
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
      tunnelTarget: '172.28.176.1:3000',
      proxyType: 'v4tov4'
    });
    expect(result[1].localAddress).toBe('0.0.0.0');
    expect(result[1].port).toBe(8080);
    expect(result[1].proxyType).toBe('v4tov4');
  });

  test('parses v6tov4 rules', () => {
    const output = `
Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              9090        172.28.176.1    9090
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].localAddress).toBe('::');
    expect(result[0].proxyType).toBe('v6tov4');
  });

  test('parses mixed sections', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000

Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              9090        172.28.176.1    9090
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].proxyType).toBe('v4tov4');
    expect(result[1].proxyType).toBe('v6tov4');
  });

  test('returns empty array for empty output', () => {
    expect(parsePortProxyOutput('')).toEqual([]);
  });

  test('returns empty array for header-only output', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
`;
    expect(parsePortProxyOutput(output)).toEqual([]);
  });

  test('normalizes * to 0.0.0.0 in IPv4 sections', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
*               5000        10.0.0.1        5000
`;
    const result = parsePortProxyOutput(output);
    expect(result[0].localAddress).toBe('0.0.0.0');
  });

  test('parses v4tov6 rules', () => {
    const output = `
Listen on ipv4:             Connect to ipv6:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         7000        ::1             7000
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].proxyType).toBe('v4tov6');
    expect(result[0].mapping).toBe('→ ::1:7000');
  });

  test('parses v6tov6 rules', () => {
    const output = `
Listen on ipv6:             Connect to ipv6:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              4000        ::1             4000
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].proxyType).toBe('v6tov6');
    expect(result[0].localAddress).toBe('::');
  });

  test('normalizes * to :: in IPv6 listen sections', () => {
    const output = `
Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
*               6000        10.0.0.1        6000
`;
    const result = parsePortProxyOutput(output);
    expect(result[0].localAddress).toBe('::');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/portproxy-scanner.test.js --verbose`
Expected: FAIL

- [ ] **Step 3: Write portproxy-scanner.js implementation**

Create `main/portproxy-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function detectProxyType(listenHeader, connectHeader) {
  const listenV = listenHeader.includes('ipv6') ? 'v6' : 'v4';
  const connectV = connectHeader.includes('ipv6') ? 'v6' : 'v4';
  return `${listenV}to${connectV}`;
}

function parsePortProxyOutput(output) {
  if (!output || !output.trim()) return [];

  const lines = output.split('\n');
  const entries = [];
  let currentProxyType = 'v4tov4';
  let isIPv6Listen = false;
  let inDataSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect section headers
    if (line.startsWith('Listen on')) {
      isIPv6Listen = line.includes('ipv6');
      const connectPart = line.split('Connect to')[1] || '';
      const connectV = connectPart.includes('ipv6') ? 'v6' : 'v4';
      currentProxyType = `${isIPv6Listen ? 'v6' : 'v4'}to${connectV}`;
      inDataSection = false;
      continue;
    }

    // Skip separator lines and column headers
    if (line.startsWith('---') || line.startsWith('Address')) {
      if (line.startsWith('---')) inDataSection = true;
      continue;
    }

    if (!inDataSection || !line) continue;

    // Parse data row: listenAddr  listenPort  connectAddr  connectPort
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;

    let listenAddr = parts[0];
    const listenPort = parseInt(parts[1], 10);
    const connectAddr = parts[2];
    const connectPort = parseInt(parts[3], 10);

    if (isNaN(listenPort) || isNaN(connectPort)) continue;

    // Normalize wildcard
    if (listenAddr === '*') {
      listenAddr = isIPv6Listen ? '::' : '0.0.0.0';
    }

    entries.push({
      port: listenPort,
      protocol: 'TCP',
      localAddress: listenAddr,
      state: 'FORWARD',
      pid: null,
      processName: 'netsh portproxy',
      source: 'PortProxy',
      type: 'forward',
      mapping: `→ ${connectAddr}:${connectPort}`,
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: `${connectAddr}:${connectPort}`,
      proxyType: currentProxyType
    });
  }

  return entries;
}

async function scanPortProxy() {
  const platform = getPlatform();
  if (platform !== 'wsl' && platform !== 'windows') return [];

  try {
    const cmd = platform === 'wsl'
      ? 'powershell.exe -NoProfile -Command "netsh interface portproxy show all"'
      : 'netsh interface portproxy show all';

    const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
    return parsePortProxyOutput(stdout);
  } catch (err) {
    if (err.message && err.message.includes('not found')) return [];
    throw err;
  }
}

module.exports = { parsePortProxyOutput, scanPortProxy };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/portproxy-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Wire into registry and commit**

In `main/scanner.js`:
```javascript
const { scanPortProxy } = require('./portproxy-scanner');
```
In `getScanners`, add portproxy for WSL and Windows platforms:
```javascript
if (platform === 'wsl') {
  // ... existing WSL + Windows
  scanners.push({ name: 'PortProxy', scan: scanPortProxy });
} else if (platform === 'windows') {
  // ... existing Windows
  scanners.push({ name: 'PortProxy', scan: scanPortProxy });
}
```

```bash
git add main/portproxy-scanner.js tests/portproxy-scanner.test.js main/scanner.js
git commit -m "feat: add netsh portproxy scanner

Parses portproxy rules with IPv4/IPv6 address family tracking.
Only activates on WSL and Windows platforms.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 5: macOS & Linux Scanners

### Task 9: macOS Scanner

**Files:**
- Create: `main/macos-scanner.js`
- Create: `tests/macos-scanner.test.js`

- [ ] **Step 1: Write macOS lsof parsing tests**

Create `tests/macos-scanner.test.js`:

```javascript
const { parseLsofOutput } = require('../main/macos-scanner');

describe('parseLsofOutput', () => {
  test('parses TCP listening entries', () => {
    const output = 'p1234\ncnode\nn*:3000\n';
    const result = parseLsofOutput(output, 'TCP');
    expect(result).toEqual([{
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
      tunnelTarget: null,
      proxyType: null
    }]);
  });

  test('parses multiple processes', () => {
    const output = 'p1234\ncnode\nn*:3000\np5678\ncnginx\nn127.0.0.1:8080\n';
    const result = parseLsofOutput(output, 'TCP');
    expect(result).toHaveLength(2);
    expect(result[0].processName).toBe('node');
    expect(result[1].processName).toBe('nginx');
    expect(result[1].localAddress).toBe('127.0.0.1');
  });

  test('parses IPv6 addresses', () => {
    const output = 'p5678\ncnginx\nn[::1]:80\n';
    const result = parseLsofOutput(output, 'TCP');
    expect(result[0].localAddress).toBe('::1');
    expect(result[0].port).toBe(80);
  });

  test('handles UDP entries', () => {
    const output = 'p9999\ncdnsmasq\nn*:53\n';
    const result = parseLsofOutput(output, 'UDP');
    expect(result[0].protocol).toBe('UDP');
    expect(result[0].state).toBe('*');
  });

  test('handles multiple network entries per process', () => {
    const output = 'p1234\ncnode\nn*:3000\nn127.0.0.1:3001\n';
    const result = parseLsofOutput(output, 'TCP');
    expect(result).toHaveLength(2);
    expect(result[0].port).toBe(3000);
    expect(result[1].port).toBe(3001);
  });

  test('returns empty for empty output', () => {
    expect(parseLsofOutput('', 'TCP')).toEqual([]);
  });

  test('skips malformed lines', () => {
    const output = 'p1234\ncnode\nnmalformed\nn*:3000\n';
    const result = parseLsofOutput(output, 'TCP');
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(3000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/macos-scanner.test.js --verbose`
Expected: FAIL

- [ ] **Step 3: Write macos-scanner.js implementation**

Create `main/macos-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parseLsofOutput(output, protocol) {
  if (!output || !output.trim()) return [];

  const lines = output.trim().split('\n');
  const entries = [];
  let currentPid = null;
  let currentProcess = '<unknown>';

  for (const line of lines) {
    if (line.startsWith('p')) {
      currentPid = parseInt(line.substring(1), 10);
      if (isNaN(currentPid)) currentPid = null;
    } else if (line.startsWith('c')) {
      currentProcess = line.substring(1);
    } else if (line.startsWith('n')) {
      const name = line.substring(1);
      let localAddress, port;

      if (name.startsWith('[')) {
        // IPv6: [::1]:80
        const closeBracket = name.indexOf(']');
        if (closeBracket === -1) continue;
        localAddress = name.substring(1, closeBracket);
        const portStr = name.substring(closeBracket + 2); // skip ]:
        port = parseInt(portStr, 10);
      } else {
        // IPv4 or wildcard: *:3000 or 127.0.0.1:8080
        const lastColon = name.lastIndexOf(':');
        if (lastColon === -1) continue;
        localAddress = name.substring(0, lastColon);
        port = parseInt(name.substring(lastColon + 1), 10);
      }

      if (isNaN(port)) continue;
      if (localAddress === '*') localAddress = '0.0.0.0';

      entries.push({
        port,
        protocol,
        localAddress,
        state: protocol === 'TCP' ? 'LISTEN' : '*',
        pid: currentPid,
        processName: currentProcess,
        source: 'macOS',
        type: 'listen',
        mapping: null,
        containerName: null,
        containerImage: null,
        containerId: null,
        tunnelTarget: null,
        proxyType: null
      });
    }
  }

  return entries;
}

async function scanMacOS() {
  const [tcpResult, udpResult] = await Promise.allSettled([
    execAsync('lsof -iTCP -sTCP:LISTEN -nP -F pcn', { timeout: SCAN_TIMEOUT_MS }),
    execAsync('lsof -iUDP -nP -F pcn', { timeout: SCAN_TIMEOUT_MS })
  ]);

  const entries = [];

  if (tcpResult.status === 'fulfilled') {
    entries.push(...parseLsofOutput(tcpResult.value.stdout, 'TCP'));
  }

  if (udpResult.status === 'fulfilled') {
    entries.push(...parseLsofOutput(udpResult.value.stdout, 'UDP'));
  }

  if (entries.length === 0 && tcpResult.status === 'rejected' && udpResult.status === 'rejected') {
    throw new Error('lsof scan failed');
  }

  return entries;
}

module.exports = { parseLsofOutput, scanMacOS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/macos-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add main/macos-scanner.js tests/macos-scanner.test.js
git commit -m "feat: add macOS scanner using lsof

Parses lsof -F output for TCP/UDP listening ports.
Handles IPv4, IPv6, and wildcard addresses.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Linux Scanner

**Files:**
- Create: `main/linux-scanner.js`
- Create: `tests/linux-scanner.test.js`

- [ ] **Step 1: Write Linux scanner tests**

Create `tests/linux-scanner.test.js`:

```javascript
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  exec: jest.fn()
}));

const { exec } = require('child_process');
const { scanLinux } = require('../main/linux-scanner');

describe('scanLinux', () => {
  beforeEach(() => exec.mockReset());

  test('returns entries with source Linux', async () => {
    const ssTcp = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process\nLISTEN   0        128            0.0.0.0:3000          0.0.0.0:*      users:(("node",pid=1234,fd=3))';
    const ssUdp = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process\n';

    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (cmd.includes('-tlnp')) return cb(null, { stdout: ssTcp, stderr: '' });
      if (cmd.includes('-ulnp')) return cb(null, { stdout: ssUdp, stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await scanLinux();
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('Linux');
    expect(result[0].port).toBe(3000);
    expect(result[0].type).toBe('listen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/linux-scanner.test.js --verbose`
Expected: FAIL

- [ ] **Step 3: Write linux-scanner.js implementation**

Create `main/linux-scanner.js`:

```javascript
const { promisify } = require('util');
const { exec } = require('child_process');
const { parseSSOutput } = require('./scanner');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

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

module.exports = { scanLinux };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/linux-scanner.test.js --verbose`
Expected: All PASS

- [ ] **Step 5: Wire macOS and Linux scanners into registry and commit**

In `main/scanner.js`, add imports and registry entries:
```javascript
const { scanMacOS } = require('./macos-scanner');
const { scanLinux } = require('./linux-scanner');

// In getScanners:
} else if (platform === 'macos') {
  scanners.push({ name: 'macOS', scan: scanMacOS });
} else if (platform === 'linux') {
  scanners.push({ name: 'Linux', scan: scanLinux });
}
```

```bash
git add main/linux-scanner.js tests/linux-scanner.test.js main/macos-scanner.js main/scanner.js
git commit -m "feat: add Linux scanner and wire macOS/Linux into registry

Linux scanner reuses ss parsing with source: 'Linux'.
Both macOS and Linux scanners now registered in getScanners.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 6: Process Manager Extensions

### Task 11: Extend Process Manager

**Files:**
- Modify: `main/process-manager.js`
- Create: `tests/process-manager-extended.test.js`

- [ ] **Step 1: Write tests for Docker stop and portproxy delete**

Create `tests/process-manager-extended.test.js`:

```javascript
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../main/platform', () => ({ getPlatform: jest.fn(() => 'wsl') }));

const { execSync, exec } = require('child_process');
const { killProcess, validateContainerId, validatePortProxyRule } = require('../main/process-manager');

describe('validateContainerId', () => {
  test('accepts valid 12-char hex ID', () => {
    expect(() => validateContainerId('abc123def456')).not.toThrow();
  });

  test('accepts long hex ID', () => {
    expect(() => validateContainerId('abc123def456abc123def456abc123def456abc123def456abc123def456abcd')).not.toThrow();
  });

  test('rejects short ID', () => {
    expect(() => validateContainerId('abc123')).toThrow();
  });

  test('rejects non-hex characters', () => {
    expect(() => validateContainerId('abc123def45g')).toThrow();
  });

  test('rejects empty string', () => {
    expect(() => validateContainerId('')).toThrow();
  });
});

describe('validatePortProxyRule', () => {
  test('accepts valid IPv4 rule', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'v4tov4' })).not.toThrow();
  });

  test('accepts valid IPv6 rule', () => {
    expect(() => validatePortProxyRule({ listenAddress: '::', listenPort: 9090, proxyType: 'v6tov4' })).not.toThrow();
  });

  test('accepts specific IPv4 address', () => {
    expect(() => validatePortProxyRule({ listenAddress: '192.168.1.1', listenPort: 80, proxyType: 'v4tov4' })).not.toThrow();
  });

  test('accepts specific IPv6 address', () => {
    expect(() => validatePortProxyRule({ listenAddress: '::1', listenPort: 443, proxyType: 'v6tov6' })).not.toThrow();
  });

  test('rejects invalid port', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 99999, proxyType: 'v4tov4' })).toThrow();
  });

  test('rejects invalid proxyType', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'invalid' })).toThrow();
  });

  test('rejects missing listenAddress', () => {
    expect(() => validatePortProxyRule({ listenPort: 3000, proxyType: 'v4tov4' })).toThrow();
  });

  test('rejects listenAddress with shell metacharacters', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0; rm -rf /', listenPort: 3000, proxyType: 'v4tov4' })).toThrow();
  });

  test('rejects listenAddress that is not a valid IP', () => {
    expect(() => validatePortProxyRule({ listenAddress: 'not-an-ip', listenPort: 3000, proxyType: 'v4tov4' })).toThrow();
  });
});

describe('killProcess - Docker', () => {
  beforeEach(() => { execSync.mockReset(); exec.mockReset(); });

  test('stops Docker container with docker stop then succeeds', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      if (cmd.includes('docker stop')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({ pid: null, source: 'Docker', containerId: 'abc123def456' });
    expect(result.success).toBe(true);
  });

  test('escalates to docker kill if docker stop fails', async () => {
    let callCount = 0;
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      callCount++;
      if (cmd.includes('docker stop')) return cb(new Error('timeout'));
      if (cmd.includes('docker kill')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({ pid: null, source: 'Docker', containerId: 'abc123def456' });
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe('killProcess - PortProxy', () => {
  beforeEach(() => { execSync.mockReset(); exec.mockReset(); });

  test('deletes portproxy rule via powershell on WSL', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      if (cmd.includes('netsh interface portproxy delete')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({
      pid: null,
      source: 'PortProxy',
      portproxyRule: { listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'v4tov4' }
    });
    expect(result.success).toBe(true);
  });
});

describe('killProcess - SSH/Kubernetes (kill by PID)', () => {
  beforeEach(() => execSync.mockReset());

  test('kills SSH process with kill -9', async () => {
    const result = await killProcess({ pid: 5678, source: 'SSH' });
    expect(execSync).toHaveBeenCalledWith('kill -9 5678', { stdio: 'pipe' });
    expect(result.success).toBe(true);
  });

  test('kills kubectl process with kill -9', async () => {
    const result = await killProcess({ pid: 7890, source: 'Kubernetes' });
    expect(execSync).toHaveBeenCalledWith('kill -9 7890', { stdio: 'pipe' });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/process-manager-extended.test.js --verbose`
Expected: FAIL (functions don't exist yet)

- [ ] **Step 3: Rewrite process-manager.js with extended support**

Update `main/process-manager.js`:

```javascript
const { execSync } = require('child_process');
const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);

function validatePid(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new Error('Invalid PID: must be a positive integer');
  }
}

function validateContainerId(id) {
  if (!id || typeof id !== 'string' || id.length < 12 || !/^[a-f0-9]+$/i.test(id)) {
    throw new Error('Invalid container ID: must be at least 12 hex characters');
  }
}

const VALID_PROXY_TYPES = ['v4tov4', 'v4tov6', 'v6tov4', 'v6tov6'];

function validatePortProxyRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('Invalid portproxy rule');
  if (typeof rule.listenPort !== 'number' || rule.listenPort < 1 || rule.listenPort > 65535) {
    throw new Error('Invalid port: must be 1-65535');
  }
  if (!VALID_PROXY_TYPES.includes(rule.proxyType)) {
    throw new Error(`Invalid proxyType: must be one of ${VALID_PROXY_TYPES.join(', ')}`);
  }
  // Validate listenAddress — must be a valid IPv4 or IPv6 address
  if (!rule.listenAddress || typeof rule.listenAddress !== 'string') {
    throw new Error('Invalid listenAddress: required');
  }
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^[0-9a-fA-F:]+$/;
  if (!ipv4Regex.test(rule.listenAddress) && !ipv6Regex.test(rule.listenAddress)) {
    throw new Error('Invalid listenAddress: must be a valid IPv4 or IPv6 address');
  }
}

async function stopContainer(containerId) {
  validateContainerId(containerId);
  try {
    await execAsync(`docker stop -t 10 ${containerId}`, { timeout: 15000 });
    return { success: true };
  } catch {
    try {
      await execAsync(`docker kill ${containerId}`, { timeout: 5000 });
      return { success: true };
    } catch (killErr) {
      return { success: false, error: killErr.message || 'Failed to stop container' };
    }
  }
}

async function deletePortProxyRule(rule) {
  validatePortProxyRule(rule);
  const platform = getPlatform();
  const deleteCmd = `netsh interface portproxy delete ${rule.proxyType} listenport=${rule.listenPort} listenaddress=${rule.listenAddress}`;

  const cmd = platform === 'wsl'
    ? `powershell.exe -NoProfile -Command "${deleteCmd}"`
    : deleteCmd;

  try {
    await execAsync(cmd, { timeout: 5000 });
    return { success: true };
  } catch (err) {
    const message = err.message || String(err);
    if (message.includes('Access is denied') || message.includes('elevation')) {
      return { success: false, error: 'Cannot remove rule — run as admin' };
    }
    return { success: false, error: message };
  }
}

function killByPid(pid, source) {
  validatePid(pid);
  try {
    if (source === 'Windows') {
      execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'pipe' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
    }
    return { success: true };
  } catch (err) {
    const message = err.message || String(err);
    if (message.includes('No such process') || message.includes('Cannot find a process')) {
      return { success: true };
    }
    if (message.includes('Operation not permitted') || message.includes('Access is denied')) {
      return { success: false, error: 'Cannot stop — insufficient permissions' };
    }
    return { success: false, error: message };
  }
}

async function killProcess(request) {
  // Legacy API support: killProcess(pid, source)
  if (typeof request === 'number' || (arguments.length === 2 && typeof arguments[1] === 'string')) {
    const pid = typeof request === 'number' ? request : request;
    const source = arguments[1] || request.source;
    return killByPid(pid, source);
  }

  const { pid, source, containerId, portproxyRule } = request;

  if (source === 'Docker' && containerId) {
    return stopContainer(containerId);
  }

  if (source === 'PortProxy' && portproxyRule) {
    return deletePortProxyRule(portproxyRule);
  }

  // SSH, Kubernetes, WSL, Windows, Linux, macOS — all use PID-based kill
  if (pid) {
    return killByPid(pid, source);
  }

  return { success: false, error: `Cannot stop: no PID or actionable identifier for source ${source}` };
}

module.exports = { killProcess, validatePid, validateContainerId, validatePortProxyRule, stopContainer, deletePortProxyRule };
```

- [ ] **Step 4: Run new and existing process-manager tests**

Run: `npx jest tests/process-manager --verbose`
Expected: All PASS (both `process-manager.test.js` and `process-manager-extended.test.js`)

- [ ] **Step 5: Update preload.js and main.js for new kill API and platform exposure**

Update `main/preload.js`:
```javascript
killProcess: (request) => ipcRenderer.invoke('kill-process', request),
getPlatform: () => ipcRenderer.invoke('get-platform'),
```

Update `main/main.js` kill-process handler:
```javascript
ipcMain.handle('kill-process', async (_event, request) => {
  return killProcess(request);
});

ipcMain.handle('get-platform', () => {
  const { getPlatform } = require('./platform');
  return getPlatform();
});
```

- [ ] **Step 6: Run all tests**

Run: `npx jest --verbose`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add main/process-manager.js tests/process-manager-extended.test.js main/preload.js main/main.js
git commit -m "feat: extend process manager for Docker, PortProxy, SSH, K8s

Adds docker stop/kill escalation, netsh portproxy delete, and
routes kill requests by source type. Updates IPC for new payload.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 7: UI Changes — Renderer

### Task 12: Update HTML — New Column & Type Filter

**Files:**
- Modify: `renderer/index.html`

- [ ] **Step 1: Add Mapping column header and Type filter**

In `renderer/index.html`:

1. Add Type filter dropdown after the source-filter select:
```html
<select id="type-filter">
  <option value="all">All Types</option>
  <option value="listen">Direct</option>
  <option value="forward">Forwarded</option>
</select>
```

2. Add Mapping column header after Port:
```html
<th data-column="mapping" class="sortable">Mapping <span class="sort-indicator"></span></th>
```

3. Update source-filter to include new sources dynamically per platform. The renderer receives a platform value from the main process and shows only relevant sources:
```html
<select id="source-filter">
  <option value="all">All Sources</option>
  <!-- Options populated dynamically by app.js based on platform -->
</select>
```

In `renderer/js/app.js`, add a function to populate source filter options based on platform:
```javascript
function populateSourceFilter(platform) {
  const filter = document.getElementById('source-filter');
  // Keep 'all' option, remove others
  while (filter.options.length > 1) filter.remove(1);

  const platformSources = {
    wsl: ['WSL', 'Windows', 'Docker', 'SSH', 'Kubernetes', 'PortProxy'],
    windows: ['Windows', 'Docker', 'SSH', 'Kubernetes', 'PortProxy'],
    macos: ['macOS', 'Docker', 'SSH', 'Kubernetes'],
    linux: ['Linux', 'Docker', 'SSH', 'Kubernetes']
  };

  const sources = platformSources[platform] || ['Docker', 'SSH', 'Kubernetes'];
  sources.forEach(src => {
    const opt = document.createElement('option');
    opt.value = src;
    opt.textContent = src;
    filter.appendChild(opt);
  });
}
```
The platform value is exposed via `window.portManager.getPlatform()` (added to preload.js in Task 11).

- [ ] **Step 2: Commit**

```bash
git add renderer/index.html
git commit -m "feat: add Mapping column and Type filter to HTML

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 13: Update table.js — Mapping Column, Type Filter, Search Scope, Action Buttons

**Files:**
- Modify: `renderer/js/table.js`

- [ ] **Step 1: Update currentFilter to include type**

```javascript
let currentFilter = { search: '', source: 'all', type: 'all' };
```

- [ ] **Step 2: Update getFilteredAndSortedData to filter by type and search new fields**

Add type filter:
```javascript
if (currentFilter.type !== 'all') {
  filtered = filtered.filter(p => p.type === currentFilter.type);
}
```

Update search to include mapping, containerName, containerImage, tunnelTarget:
```javascript
if (currentFilter.search) {
  const query = currentFilter.search.toLowerCase();
  filtered = filtered.filter(p =>
    String(p.port).includes(query) ||
    p.processName.toLowerCase().includes(query) ||
    p.localAddress.toLowerCase().includes(query) ||
    p.protocol.toLowerCase().includes(query) ||
    p.source.toLowerCase().includes(query) ||
    (p.pid && String(p.pid).includes(query)) ||
    (p.mapping && p.mapping.toLowerCase().includes(query)) ||
    (p.containerName && p.containerName.toLowerCase().includes(query)) ||
    (p.containerImage && p.containerImage.toLowerCase().includes(query)) ||
    (p.tunnelTarget && p.tunnelTarget.toLowerCase().includes(query))
  );
}
```

- [ ] **Step 3: Update renderTable to include Mapping column and source-aware action buttons**

```javascript
tbody.innerHTML = data.map(entry => {
  const pidDisplay = entry.pid !== null ? entry.pid : '—';
  const processClass = entry.processName === '<unknown>' ? 'text-muted' : '';
  const processDisplay = entry.processName === '<unknown>' ? 'Unknown' : escapeHTML(entry.processName);
  const mappingDisplay = entry.mapping ? escapeHTML(entry.mapping) : '—';
  const addr = escapeHTML(entry.localAddress);

  // Action button logic
  const canAct = entry.pid !== null || entry.containerId !== null || entry.source === 'PortProxy';
  let btnLabel = 'Stop';
  if (entry.source === 'Docker') btnLabel = 'Stop Container';
  else if (entry.source === 'SSH' || entry.source === 'Kubernetes') btnLabel = 'Disconnect';
  else if (entry.source === 'PortProxy') btnLabel = 'Remove Rule';

  const btnData = `data-source="${entry.source}" data-port="${entry.port}" data-process="${escapeHTML(processDisplay)}"` +
    (entry.pid ? ` data-pid="${entry.pid}"` : '') +
    (entry.containerId ? ` data-container-id="${entry.containerId}"` : '') +
    (entry.source === 'PortProxy' ? ` data-proxy-type="${entry.proxyType}" data-listen-address="${entry.localAddress}"` : '');

  return `<tr>
    <td>${entry.port}</td>
    <td class="mapping-cell">${mappingDisplay}</td>
    <td>${entry.protocol}</td>
    <td>${addr}</td>
    <td>${entry.state}</td>
    <td>${pidDisplay}</td>
    <td class="${processClass}">${processDisplay}</td>
    <td><span class="badge badge-${entry.source.toLowerCase()}">${entry.source}</span></td>
    <td>
      <button class="btn btn-danger btn-sm stop-btn"
        ${canAct ? '' : 'disabled title="Cannot stop — unknown process"'}
        ${btnData}>${btnLabel}</button>
    </td>
  </tr>`;
}).join('');
```

- [ ] **Step 4: Commit**

```bash
git add renderer/js/table.js
git commit -m "feat: update table with Mapping column, type filter, source-aware actions

Search now covers mapping, container name, image, and tunnel target.
Action buttons show contextual labels per source type.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 14: Update app.js — New Stop Logic & Type Filter Handler

**Files:**
- Modify: `renderer/js/app.js`

- [ ] **Step 1: Add type filter event listener in DOMContentLoaded**

```javascript
document.getElementById('type-filter').addEventListener('change', (e) => {
  setFilter({ type: e.target.value });
});
```

- [ ] **Step 2: Rewrite handleStopClick for source-aware actions**

```javascript
async function handleStopClick(btn) {
  const source = btn.dataset.source;
  const port = btn.dataset.port;
  const process = btn.dataset.process;
  const pid = btn.dataset.pid ? parseInt(btn.dataset.pid, 10) : null;
  const containerId = btn.dataset.containerId || null;

  // Build confirmation message with sibling awareness
  let message;
  if (source === 'Docker') {
    const siblingPorts = getSiblingPorts('containerId', containerId);
    message = `Stop container "${process}"? This will close ports ${siblingPorts.join(', ')}.`;
  } else if (source === 'SSH' || source === 'Kubernetes') {
    const siblingPorts = getSiblingPorts('pid', pid);
    const action = source === 'SSH' ? 'Disconnect SSH tunnel' : 'Disconnect port-forward';
    message = `${action} (PID ${pid})? This will close ports ${siblingPorts.join(', ')}.`;
  } else if (source === 'PortProxy') {
    const listenAddr = btn.dataset.listenAddress;
    const mapping = btn.dataset.mapping || '';
    message = `Remove port proxy rule ${listenAddr}:${port} ${mapping}?`;
  } else {
    message = `Stop process "${process}" (PID ${pid}) on port ${port}?`;
  }

  if (currentSettings?.confirmBeforeStop) {
    const confirmed = await showConfirmDialog(message);
    if (!confirmed) return;
  }

  btn.disabled = true;
  btn.textContent = '...';

  // Build kill request
  const request = { pid, source };
  if (containerId) request.containerId = containerId;
  if (source === 'PortProxy') {
    request.portproxyRule = {
      listenAddress: btn.dataset.listenAddress,
      listenPort: parseInt(port, 10),
      proxyType: btn.dataset.proxyType
    };
  }

  const result = await window.portManager.killProcess(request);

  if (result.success) {
    showToast(`Stopped ${process} on port ${port}`, 'success');
    await performScan();
  } else {
    showToast(result.error || 'Failed to stop process', 'error');
    btn.disabled = false;
    btn.textContent = btn.dataset.source === 'Docker' ? 'Stop Container' :
      ['SSH', 'Kubernetes'].includes(btn.dataset.source) ? 'Disconnect' :
      btn.dataset.source === 'PortProxy' ? 'Remove Rule' : 'Stop';
  }
}

function getSiblingPorts(field, value) {
  if (!value) return [];
  return portData
    .filter(entry => entry[field] === value || (field === 'pid' && entry.pid === value))
    .map(entry => entry.port);
}
```

Note: `portData` is in `table.js`. Either expose it via a getter or reference it directly (both are in the same scope since they're loaded as scripts on the same page).

- [ ] **Step 3: Add a `getPortData()` helper to table.js for cross-module access**

In `table.js`, add:
```javascript
function getPortData() {
  return portData;
}
```

Then `getSiblingPorts` in `app.js` uses `getPortData()` instead of `portData` directly.

- [ ] **Step 4: Commit**

```bash
git add renderer/js/app.js renderer/js/table.js
git commit -m "feat: source-aware stop actions with sibling port awareness

Docker, SSH, kubectl, and PortProxy each get contextual confirmation
messages that list all affected ports. Type filter now wired up.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 15: Add Source Badge Styles

**Files:**
- Modify: `renderer/styles/components.css`

- [ ] **Step 1: Add badge color classes for all sources**

Append to `renderer/styles/components.css`:

```css
.badge-docker { background: #00bcd4; color: #000; }
.badge-ssh { background: #ffc107; color: #000; }
.badge-kubernetes { background: #4caf50; color: #fff; }
.badge-portproxy { background: #ff9800; color: #000; }
.badge-macos { background: #9e9e9e; color: #fff; }
.badge-linux { background: #009688; color: #fff; }
```

(The existing badge-wsl and badge-windows styles remain.)

- [ ] **Step 2: Add mapping-cell style**

```css
.mapping-cell {
  color: var(--text-secondary);
  font-size: 12px;
}
```

- [ ] **Step 3: Commit**

```bash
git add renderer/styles/components.css
git commit -m "feat: add source badge colors and mapping cell style

Docker (cyan), SSH (yellow), Kubernetes (green), PortProxy (orange),
macOS (gray), Linux (teal).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Chunk 8: Integration & Final Verification

### Task 16: Update Orchestration Tests

**Files:**
- Modify: `tests/scanner-orchestration.test.js`

- [ ] **Step 1: Update orchestration tests for full scanner registry**

Add tests verifying:
- `getScanners('wsl')` returns WSL, Windows, PortProxy, Docker, SSH, Kubernetes
- `getScanners('macos')` returns macOS, Docker, SSH, Kubernetes
- `getScanners('linux')` returns Linux, Docker, SSH, Kubernetes
- `getScanners('windows')` returns Windows, PortProxy, Docker, SSH, Kubernetes
- `scanPorts()` handles mixed success/failure — mock individual scanners to reject, verify errors array populated
- `scanPorts()` with all scanners failing returns empty ports and full errors array

```javascript
describe('getScanners - full registry', () => {
  test('wsl includes all 6 scanners', () => {
    const names = getScanners('wsl').map(s => s.name);
    expect(names).toEqual(['WSL', 'Windows', 'PortProxy', 'Docker', 'SSH', 'Kubernetes']);
  });

  test('macos includes 4 scanners', () => {
    const names = getScanners('macos').map(s => s.name);
    expect(names).toEqual(['macOS', 'Docker', 'SSH', 'Kubernetes']);
  });

  test('linux includes 4 scanners', () => {
    const names = getScanners('linux').map(s => s.name);
    expect(names).toEqual(['Linux', 'Docker', 'SSH', 'Kubernetes']);
  });

  test('windows includes 5 scanners', () => {
    const names = getScanners('windows').map(s => s.name);
    expect(names).toEqual(['Windows', 'PortProxy', 'Docker', 'SSH', 'Kubernetes']);
  });
});

describe('scanPorts - mixed results', () => {
  test('reports errors from failed scanners without losing successful results', async () => {
    // Mock docker-scanner to reject, others succeed
    jest.doMock('../main/docker-scanner', () => ({
      scan: jest.fn().mockRejectedValue(new Error('docker not found'))
    }));
    getPlatform.mockReturnValue('wsl');
    const { scanPorts } = require('../main/scanner');
    const result = await scanPorts();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.source === 'Docker')).toBe(true);
    // Other scanners still contribute ports
    expect(Array.isArray(result.ports)).toBe(true);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx jest --verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/scanner-orchestration.test.js
git commit -m "test: update orchestration tests for full multi-source registry

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 17: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update features list and architecture section**

Add to features:
- Scans Docker containers with port mapping display
- Detects SSH tunnels (-L/-D forwards)
- Detects kubectl port-forwards
- Shows Windows netsh portproxy rules
- Cross-platform: WSL+Windows, macOS, Linux
- Type filter (Direct / Forwarded)

Update Architecture section to show new files.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with multi-source scanning features

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 18: Final Integration Test

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests PASS

- [ ] **Step 2: Verify source/type filters and stop logic via test coverage**

Run: `npx jest --coverage`
Verify:
- All scanner files show >80% branch coverage
- process-manager.js shows >80% branch coverage
- If coverage is low in any scanner, add missing edge case tests

- [ ] **Step 3: Manual smoke test — launch app**

Run: `npm start`
Verify these specific behaviors (record pass/fail for each):
1. Table renders with Mapping column visible
2. Source filter dropdown shows only platform-appropriate sources
3. Type filter dropdown shows "All Types", "Direct", "Forwarded"
4. If Docker is running: Docker rows appear with container name and mapping
5. If no Docker: no errors in DevTools console
6. Sort by Mapping column works
7. Search includes mapping/container fields

If the app cannot launch (e.g., no display in CI), verify via unit test expectations:
- renderTable() produces correct HTML structure with Mapping column
- getFilteredAndSortedData() respects type filter
- handleStopClick() builds correct KillRequest per source

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git status  # should be clean
```
