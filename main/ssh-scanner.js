const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function resolveBindAddress(bind) {
  if (bind === null || bind === undefined) return '127.0.0.1';
  if (bind === '' || bind === ':' || bind === '*') return '0.0.0.0';
  if (bind.startsWith('[') && bind.endsWith(']')) return bind.slice(1, -1);
  return bind;
}

function parseLocalForward(spec, pid) {
  let bindAddress = null;
  let port, host, hostport;

  if (spec.startsWith('[')) {
    const closeBracket = spec.indexOf(']');
    bindAddress = spec.substring(0, closeBracket + 1);
    const rest = spec.substring(closeBracket + 2);
    const parts = rest.split(':');
    port = parseInt(parts[0], 10);
    host = parts[1];
    hostport = parts[2];
  } else {
    const parts = spec.split(':');
    if (parts.length === 3) {
      port = parseInt(parts[0], 10);
      host = parts[1];
      hostport = parts[2];
    } else if (parts.length === 4) {
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
  const args = cmdline.split(/\s+/);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-L' && i + 1 < args.length) {
      const entry = parseLocalForward(args[i + 1], pid);
      if (entry) entries.push(entry);
      i++;
    } else if (args[i] === '-D' && i + 1 < args.length) {
      const entry = parseDynamicForward(args[i + 1], pid);
      if (entry) entries.push(entry);
      i++;
    }
  }

  return entries;
}

async function scanSSH() {
  const platform = getPlatform();

  try {
    let cmd;
    if (platform === 'windows') {
      cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'ssh.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"';
    } else {
      cmd = "ps -eo pid,args 2>/dev/null | grep '[s]sh.*-[LD]'";
    }

    const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
    if (!stdout.trim()) return [];

    const entries = [];

    if (platform === 'windows') {
      let processes = JSON.parse(stdout);
      if (!Array.isArray(processes)) processes = [processes];
      for (const proc of processes) {
        if (proc.CommandLine) {
          entries.push(...parseSSHForwards(proc.CommandLine, proc.ProcessId));
        }
      }
    } else {
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          const cmdline = match[2];
          entries.push(...parseSSHForwards(cmdline, pid));
        }
      }
    }

    return entries;
  } catch (err) {
    if (err.code === 1 || (err.message && err.message.includes('No matching'))) {
      return [];
    }
    throw err;
  }
}

module.exports = { parseLocalForward, parseDynamicForward, parseSSHForwards, resolveBindAddress, scanSSH };
