const { execSync } = require('child_process');
const { promisify } = require('util');
const { exec } = require('child_process');
const { getPlatform } = require('./platform');

const execAsync = promisify(exec);

const VALID_PROXY_TYPES = ['v4tov4', 'v4tov6', 'v6tov4', 'v6tov6'];

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

function validatePortProxyRule(rule) {
  if (!rule || typeof rule !== 'object') throw new Error('Invalid portproxy rule');
  if (typeof rule.listenPort !== 'number' || rule.listenPort < 1 || rule.listenPort > 65535) {
    throw new Error('Invalid port: must be 1-65535');
  }
  if (!VALID_PROXY_TYPES.includes(rule.proxyType)) {
    throw new Error(`Invalid proxyType: must be one of ${VALID_PROXY_TYPES.join(', ')}`);
  }
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

async function deletePortProxy(rule) {
  validatePortProxyRule(rule);
  const platform = getPlatform();
  const { listenAddress, listenPort, proxyType } = rule;

  let cmd;
  if (platform === 'wsl') {
    cmd = `powershell.exe -NoProfile -Command "netsh interface portproxy delete ${proxyType} listenaddress=${listenAddress} listenport=${listenPort}"`;
  } else {
    cmd = `netsh interface portproxy delete ${proxyType} listenaddress=${listenAddress} listenport=${listenPort}`;
  }

  try {
    await execAsync(cmd, { timeout: 5000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to delete portproxy rule' };
  }
}

async function killProcess(request) {
  // Support legacy (pid, source) call signature
  if (typeof request === 'number') {
    const pid = request;
    const source = arguments[1];
    request = { pid, source };
  }

  const { source, pid, containerId, portproxyRule } = request;

  if (source === 'Docker') {
    if (!containerId) return { success: false, error: 'Missing containerId' };
    return stopContainer(containerId);
  }

  if (source === 'PortProxy') {
    if (!portproxyRule) return { success: false, error: 'Missing portproxy rule' };
    return deletePortProxy(portproxyRule);
  }

  // SSH, Kubernetes, WSL, Linux, macOS — kill by PID
  if (source === 'SSH' || source === 'Kubernetes' || source === 'WSL' || source === 'Linux' || source === 'macOS') {
    validatePid(pid);
    try {
      execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
      return { success: true };
    } catch (err) {
      const message = err.message || String(err);
      if (message.includes('No such process')) return { success: true };
      if (message.includes('Operation not permitted')) {
        return { success: false, error: 'Cannot stop — insufficient permissions' };
      }
      return { success: false, error: message };
    }
  }

  if (source === 'Windows') {
    validatePid(pid);
    try {
      execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'pipe' });
      return { success: true };
    } catch (err) {
      const message = err.message || String(err);
      if (message.includes('Cannot find a process')) return { success: true };
      if (message.includes('Access is denied')) {
        return { success: false, error: 'Cannot stop — insufficient permissions' };
      }
      return { success: false, error: message };
    }
  }

  return { success: false, error: `Unknown source: ${source}` };
}

module.exports = { killProcess, validatePid, validateContainerId, validatePortProxyRule };
