let isScanning = false;
let refreshTimer = null;
let currentSettings = null;

async function performScan() {
  if (isScanning) return;
  isScanning = true;

  const refreshBtn = document.getElementById('refresh-btn');
  const refreshIcon = refreshBtn.querySelector('.refresh-icon');
  refreshIcon.classList.add('spinning');
  refreshBtn.disabled = true;

  try {
    const { ports, errors } = await window.portManager.scanPorts();

    setPortData(ports);
    showErrors(errors);
  } catch (err) {
    showErrors([{ source: 'App', message: err.message }]);
  } finally {
    isScanning = false;
    refreshIcon.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

function showErrors(errors) {
  const banner = document.getElementById('error-banner');
  if (errors.length === 0) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'block';
  banner.textContent = errors.map(e => `⚠ ${e.source} ports unavailable: ${e.message}`).join(' | ');
}

function scheduleRefresh() {
  clearRefreshTimer();
  if (!currentSettings || currentSettings.refreshInterval === 0) return;

  refreshTimer = setTimeout(async () => {
    await performScan();
    scheduleRefresh();
  }, currentSettings.refreshInterval);
}

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function applyTheme(theme) {
  const darkSheet = document.getElementById('theme-dark');
  const lightSheet = document.getElementById('theme-light');

  let effectiveTheme = theme;
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  darkSheet.disabled = effectiveTheme !== 'dark';
  lightSheet.disabled = effectiveTheme !== 'light';
}

async function handleStopClick(btn) {
  const pid = parseInt(btn.dataset.pid, 10);
  const source = btn.dataset.source;
  const process = btn.dataset.process;
  const port = btn.dataset.port;

  if (currentSettings?.confirmBeforeStop) {
    const confirmed = await showConfirmDialog(
      `Stop process "${process}" (PID ${pid}) on port ${port}?`
    );
    if (!confirmed) return;
  }

  btn.disabled = true;
  btn.textContent = '...';

  const result = await window.portManager.killProcess(pid, source);

  if (result.success) {
    showToast(`Stopped ${process} (PID ${pid}) on port ${port}`, 'success');
    await performScan();
  } else {
    showToast(result.error || 'Failed to stop process', 'error');
    btn.disabled = false;
    btn.textContent = 'Stop';
  }
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';

    const msgP = document.createElement('p');
    msgP.textContent = message;
    dialog.appendChild(msgP);

    const actions = document.createElement('div');
    actions.className = 'confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-danger';
    okBtn.textContent = 'Stop';
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  currentSettings = await window.portManager.getSettings();
  applyTheme(currentSettings.theme);
  populateSettings(currentSettings);

  window.portManager.onSettingsChanged((settings) => {
    const oldInterval = currentSettings?.refreshInterval;
    currentSettings = settings;
    applyTheme(settings.theme);
    populateSettings(settings);

    if (settings.refreshInterval !== oldInterval) {
      scheduleRefresh();
    }
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    setFilter({ search: e.target.value });
  });

  document.getElementById('source-filter').addEventListener('change', (e) => {
    setFilter({ source: e.target.value });
  });

  document.getElementById('refresh-btn').addEventListener('click', performScan);

  document.getElementById('port-table-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.stop-btn');
    if (btn && !btn.disabled) {
      handleStopClick(btn);
    }
  });

  initSettingsUI();

  await performScan();
  scheduleRefresh();
});
