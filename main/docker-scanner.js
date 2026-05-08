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
