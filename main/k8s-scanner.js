const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

function parsePortForwardArgs(cmdline, pid) {
  const entries = [];
  
  // Extract resource name (pod/name, svc/name, deploy/name, or just podname)
  const resourceMatch = cmdline.match(/port-forward\s+([\w\/-]+)/);
  const resource = resourceMatch ? resourceMatch[1] : 'unknown';

  // Extract address flag if present
  let bindAddress = '127.0.0.1';
  const addrMatch = cmdline.match(/--address[=\s]+([^\s]+)/);
  if (addrMatch) {
    const addr = addrMatch[1];
    if (addr === '0.0.0.0' || addr.includes('0.0.0.0')) {
      bindAddress = '0.0.0.0';
    } else if (addr === '::' || addr === '::1') {
      bindAddress = addr;
    } else {
      bindAddress = addr;
    }
  }

  // Extract port mappings (localPort:remotePort or just port for same:same)
  const portMatches = cmdline.match(/\b(\d+:\d+|\d+)\b/g);
  if (!portMatches) return entries;

  // Filter to only port-like numbers after the resource name
  const afterResource = cmdline.substring(cmdline.indexOf(resource) + resource.length);
  const portSpecs = afterResource.match(/\b(\d+:\d+)\b/g) || [];

  for (const spec of portSpecs) {
    const [localStr, remoteStr] = spec.split(':');
    const localPort = parseInt(localStr, 10);
    const remotePort = parseInt(remoteStr, 10);
    if (isNaN(localPort) || isNaN(remotePort)) continue;
    if (localPort < 1 || localPort > 65535) continue;

    entries.push({
      port: localPort,
      protocol: 'TCP',
      localAddress: bindAddress,
      state: 'LISTEN',
      pid,
      processName: 'kubectl',
      source: 'Kubernetes',
      type: 'forward',
      mapping: `→ ${resource}:${remotePort}`,
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: `${resource}:${remotePort}`,
      proxyType: null
    });
  }

  return entries;
}

async function scanK8s() {
  const platform = getPlatform();

  try {
    let cmd;
    if (platform === 'windows') {
      cmd = 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'kubectl.exe\'\\" | Select-Object ProcessId,CommandLine | ConvertTo-Json"';
    } else {
      cmd = "ps -eo pid,args 2>/dev/null | grep '[k]ubectl.*port-forward'";
    }

    const { stdout } = await execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
    if (!stdout.trim()) return [];

    const entries = [];

    if (platform === 'windows') {
      let processes = JSON.parse(stdout);
      if (!Array.isArray(processes)) processes = [processes];
      for (const proc of processes) {
        if (proc.CommandLine && proc.CommandLine.includes('port-forward')) {
          entries.push(...parsePortForwardArgs(proc.CommandLine, proc.ProcessId));
        }
      }
    } else {
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          const cmdline = match[2];
          if (cmdline.includes('port-forward')) {
            entries.push(...parsePortForwardArgs(cmdline, pid));
          }
        }
      }
    }

    return entries;
  } catch (err) {
    if (err.code === 1 || (err.message && err.message.includes('not found'))) {
      return [];
    }
    throw err;
  }
}

module.exports = { parsePortForwardArgs, scanK8s };
