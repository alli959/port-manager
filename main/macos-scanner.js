const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parseLsofLine(line) {
  // lsof output format with -i -P -n -F:
  // We use the tabular form: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  const parts = line.trim().split(/\s+/);
  if (parts.length < 9) return null;

  const processName = parts[0];
  const pid = parseInt(parts[1], 10);
  const protocol = parts[7] === 'UDP' ? 'UDP' : 'TCP';
  const namePart = parts[8];

  // NAME format: host:port or *:port or [::1]:port
  // For LISTEN state, it shows "host:port (LISTEN)"
  const state = line.includes('(LISTEN)') ? 'LISTEN' : (protocol === 'UDP' ? '*' : null);
  if (!state) return null; // Skip ESTABLISHED connections

  let localAddress, port;
  if (namePart.startsWith('[')) {
    // IPv6: [::1]:port
    const closeBracket = namePart.indexOf(']');
    localAddress = namePart.substring(1, closeBracket);
    port = parseInt(namePart.substring(closeBracket + 2), 10);
  } else {
    const lastColon = namePart.lastIndexOf(':');
    localAddress = namePart.substring(0, lastColon);
    port = parseInt(namePart.substring(lastColon + 1), 10);
  }

  if (isNaN(port) || isNaN(pid)) return null;
  if (localAddress === '*') localAddress = '0.0.0.0';

  return {
    type: 'listen',
    mapping: null,
    containerName: null,
    containerImage: null,
    containerId: null,
    tunnelTarget: null,
    proxyType: null,
    port,
    protocol,
    localAddress,
    state,
    pid,
    processName,
    source: 'macOS'
  };
}

function parseLsofOutput(output) {
  if (!output || !output.trim()) return [];

  const lines = output.trim().split('\n');
  const entries = [];

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const entry = parseLsofLine(lines[i]);
    if (entry) entries.push(entry);
  }

  return entries;
}

async function scanMacOS() {
  try {
    const { stdout } = await execAsync(
      'lsof -i -P -n -sTCP:LISTEN -sUDP:* 2>/dev/null',
      { timeout: SCAN_TIMEOUT_MS }
    );
    return parseLsofOutput(stdout);
  } catch (err) {
    if (err.code === 1 && (!err.stdout || !err.stdout.trim())) {
      return [];
    }
    if (err.stdout && err.stdout.trim()) {
      return parseLsofOutput(err.stdout);
    }
    throw err;
  }
}

module.exports = { parseLsofLine, parseLsofOutput, scanMacOS };
