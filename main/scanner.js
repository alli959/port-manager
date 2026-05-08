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

function parseWindowsTCP(json) {
  if (!json || !Array.isArray(json)) return [];

  return json.map((entry) => ({
    port: entry.LocalPort,
    protocol: 'TCP',
    localAddress: entry.LocalAddress,
    state: 'LISTEN',
    pid: entry.OwningProcess || null,
    processName: '<unknown>',
    source: 'Windows'
  }));
}

function parseWindowsUDP(json) {
  if (!json || !Array.isArray(json)) return [];

  return json.map((entry) => ({
    port: entry.LocalPort,
    protocol: 'UDP',
    localAddress: entry.LocalAddress,
    state: '*',
    pid: entry.OwningProcess || null,
    processName: '<unknown>',
    source: 'Windows'
  }));
}

function resolveProcessNames(entries, processMap) {
  return entries.map((entry) => {
    if (entry.pid && processMap[entry.pid]) {
      return { ...entry, processName: processMap[entry.pid] };
    }

    return entry;
  });
}

async function scanWSL() {
  const [tcpResult, udpResult] = await Promise.all([
    execAsync('ss -tlnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS }),
    execAsync('ss -ulnp 2>/dev/null', { timeout: SCAN_TIMEOUT_MS })
  ]);

  return [
    ...parseSSOutput(tcpResult.stdout, 'TCP'),
    ...parseSSOutput(udpResult.stdout, 'UDP')
  ];
}

async function scanWindows() {
  const tcpCmd = 'powershell.exe -NoProfile -Command "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,State,OwningProcess | ConvertTo-Json"';
  const udpCmd = 'powershell.exe -NoProfile -Command "Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json"';

  const [tcpResult, udpResult] = await Promise.all([
    execAsync(tcpCmd, { timeout: SCAN_TIMEOUT_MS }),
    execAsync(udpCmd, { timeout: SCAN_TIMEOUT_MS })
  ]);

  let tcpJson = tcpResult.stdout.trim() ? JSON.parse(tcpResult.stdout) : [];
  let udpJson = udpResult.stdout.trim() ? JSON.parse(udpResult.stdout) : [];

  if (!Array.isArray(tcpJson)) tcpJson = [tcpJson];
  if (!Array.isArray(udpJson)) udpJson = [udpJson];

  let entries = [...parseWindowsTCP(tcpJson), ...parseWindowsUDP(udpJson)];

  const pids = [...new Set(entries.filter((entry) => entry.pid).map((entry) => entry.pid))];
  if (pids.length > 0) {
    try {
      const resolveCmd = `powershell.exe -NoProfile -Command "Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json"`;
      const resolveResult = await execAsync(resolveCmd, { timeout: SCAN_TIMEOUT_MS });
      let processJson = resolveResult.stdout.trim() ? JSON.parse(resolveResult.stdout) : [];
      if (!Array.isArray(processJson)) processJson = [processJson];

      const processMap = {};
      processJson.forEach((processEntry) => {
        processMap[processEntry.Id] = processEntry.ProcessName;
      });
      entries = resolveProcessNames(entries, processMap);
    } catch {
      // Process resolution failed — continue with <unknown> names
    }
  }

  return entries;
}

async function scanPorts() {
  const results = await Promise.allSettled([scanWSL(), scanWindows()]);

  const ports = [];
  const errors = [];

  if (results[0].status === 'fulfilled') {
    ports.push(...results[0].value);
  } else {
    errors.push({ source: 'WSL', message: results[0].reason?.message || 'WSL scan failed' });
  }

  if (results[1].status === 'fulfilled') {
    ports.push(...results[1].value);
  } else {
    errors.push({ source: 'Windows', message: results[1].reason?.message || 'Windows scan failed' });
  }

  return { ports, errors };
}

module.exports = {
  parseSSLine,
  parseSSOutput,
  parseWindowsTCP,
  parseWindowsUDP,
  resolveProcessNames,
  scanWSL,
  scanWindows,
  scanPorts
};
