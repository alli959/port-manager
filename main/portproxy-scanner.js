const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);
const SCAN_TIMEOUT_MS = 5000;

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
      const listenPart = line.split('Connect to')[0] || '';
      isIPv6Listen = listenPart.includes('ipv6');
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

    // Normalize wildcard based on section type
    if (listenAddr === '*') {
      listenAddr = isIPv6Listen ? '::' : '0.0.0.0';
    }

    const target = `${connectAddr}:${connectPort}`;

    entries.push({
      port: listenPort,
      protocol: 'TCP',
      localAddress: listenAddr,
      state: 'FORWARD',
      pid: null,
      processName: 'netsh portproxy',
      source: 'PortProxy',
      type: 'forward',
      mapping: `→ ${target}`,
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: target,
      proxyType: currentProxyType
    });
  }

  return entries;
}

async function scanPortProxy() {
  const platform = getPlatform();
  if (platform !== 'wsl' && platform !== 'windows') return [];

  const families = ['v4tov4', 'v4tov6', 'v6tov4', 'v6tov6'];

  const results = await Promise.allSettled(
    families.map((family) => {
      const cmd = platform === 'wsl'
        ? `powershell.exe -NoProfile -Command "netsh interface portproxy show ${family}"`
        : `netsh interface portproxy show ${family}`;
      return execAsync(cmd, { timeout: SCAN_TIMEOUT_MS });
    })
  );

  const entries = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.stdout.trim()) {
      entries.push(...parsePortProxyOutput(result.value.stdout));
    }
  }

  return entries;
}

module.exports = { parsePortProxyOutput, scanPortProxy };
