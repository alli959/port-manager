const { exec } = require('child_process');
const { promisify } = require('util');

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
    port,
    protocol,
    localAddress,
    state: protocol === 'TCP' ? 'LISTEN' : '*',
    pid,
    processName,
    source: 'WSL'
  };
}

function parseSSOutput(output, protocol) {
  if (!output || !output.trim()) return [];

  const lines = output.trim().split('\n');
  const entries = [];

  for (let i = 1; i < lines.length; i += 1) {
    const entry = parseSSLine(lines[i], protocol);
    if (entry) entries.push(entry);
  }

  return entries;
}

module.exports = {
  parseSSLine,
  parseSSOutput
};
