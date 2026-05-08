const { execSync } = require('child_process');

function validatePid(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new Error('Invalid PID: must be a positive integer');
  }
}

async function killProcess(pid, source) {
  validatePid(pid);

  if (source !== 'WSL' && source !== 'Windows') {
    return { success: false, error: `Unknown source: ${source}` };
  }

  try {
    if (source === 'WSL') {
      execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
    } else {
      execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'pipe' });
    }
    return { success: true };
  } catch (err) {
    const message = err.message || String(err);
    if (message.includes('No such process') || message.includes('Cannot find a process')) {
      return { success: true };
    }
    if (message.includes('Operation not permitted') || message.includes('Access is denied')) {
      return { success: false, error: 'Cannot stop — insufficient permissions' };
    }
    return { success: false, error: message };
  }
}

module.exports = { killProcess, validatePid };
