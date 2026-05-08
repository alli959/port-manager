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
