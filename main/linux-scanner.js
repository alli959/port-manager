const { promisify } = require('util');
const { exec } = require('child_process');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parseSSLine(line, protocol) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const localAddrPort = parts[3];
  const lastColon = localAddrPort.lastIndexOf(':');
  if (lastColon === -1) return null;

  const localAddress = localAddrPort.substring(0, lastColon);
  const port = parseInt(localAddrPort.substring(lastColon + 1), 10);
  if (isNaN(port)) return null;

  let pid = null;
  let processName = '<unknown>';

  const usersMatch = line.match(/users:\(\("([^"]*)",pid=(\d+)/);
  if (usersMatch) {
    processName = usersMatch[1];
    pid = parseInt(usersMatch[2], 10);
  }

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
    state: protocol === 'TCP' ? 'LISTEN' : '*',
    pid,
    processName,
    source: 'Linux'
  };
}

function parseSSOutput(output, protocol) {
  if (!output || !output.trim()) return [];

  const lines = output.trim().split('\n');
  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const entry = parseSSLine(lines[i], protocol);
    if (entry) entries.push(entry);
  }

  return entries;
}

async function scanLinux() {
  const [tcpResult, udpResult] = await Promise.all([
    execAsync('ss -tlnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS }),
    execAsync('ss -ulnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS })
  ]);

  return [
    ...parseSSOutput(tcpResult.stdout, 'TCP'),
    ...parseSSOutput(udpResult.stdout, 'UDP')
  ];
}

module.exports = { parseSSLine, parseSSOutput, scanLinux };
