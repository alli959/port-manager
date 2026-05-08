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
    populateSourceFilter(ports);
    showErrors(errors);
  } catch (err) {
    showErrors([{ source: 'App', message: err.message }]);
  } finally {
    isScanning = false;
    refreshIcon.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

function populateSourceFilter(ports) {
  const select = document.getElementById('source-filter');
  const current = select.value;
  const sources = [...new Set(ports.map(p => p.source))].sort();

  // Keep "All Sources" option plus dynamic ones
  select.innerHTML = '<option value="all">All Sources</option>' +
    sources.map(s => `<option value="${s}">${s}</option>`).join('');

  // Restore selection if it still exists
  if (sources.includes(current)) {
    select.value = current;
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

function buildStopRequest(btn) {
  const source = btn.dataset.source;
  const request = {
    pid: btn.dataset.pid ? parseInt(btn.dataset.pid, 10) : null,
    source,
  };

  if (source === 'Docker' && btn.dataset.containerId) {
    request.containerId = btn.dataset.containerId;
  }

  if (source === 'PortProxy' && btn.dataset.listenAddress) {
    const port = btn.dataset.port;
    request.portproxyRule = {
      listenAddress: btn.dataset.listenAddress,
      listenPort: port,
      family: btn.dataset.proxyType || 'v4tov4',
    };
  }

  return request;
}

function getConfirmMessage(btn) {
  const source = btn.dataset.source;
  const port = btn.dataset.port;
  const process = btn.dataset.process;

  if (source === 'Docker') {
    return `Stop Docker container on port ${port}?`;
  } else if (source === 'SSH') {
    return `Disconnect SSH tunnel (PID ${btn.dataset.pid}) on port ${port}?`;
  } else if (source === 'Kubernetes') {
    return `Disconnect kubectl port-forward (PID ${btn.dataset.pid}) on port ${port}?`;
  } else if (source === 'PortProxy') {
    return `Remove portproxy rule for port ${port}?`;
  }
  return `Stop process "${process}" (PID ${btn.dataset.pid}) on port ${port}?`;
}

async function handleStopClick(btn) {
  const source = btn.dataset.source;
  const port = btn.dataset.port;
  const process = btn.dataset.process;

  if (currentSettings?.confirmBeforeStop) {
    const confirmed = await showConfirmDialog(getConfirmMessage(btn));
    if (!confirmed) return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  const request = buildStopRequest(btn);
  const result = await window.portManager.killProcess(request);

  if (result.success) {
    const desc = source === 'Docker' ? 'Stopped container' :
                 source === 'PortProxy' ? 'Removed rule' :
                 source === 'SSH' || source === 'Kubernetes' ? 'Disconnected' :
                 `Stopped ${process}`;
    showToast(`${desc} on port ${port}`, 'success');
    await performScan();
  } else {
    showToast(result.error || 'Failed to stop process', 'error');
    btn.disabled = false;
    btn.textContent = originalLabel;
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
    okBtn.textContent = 'Confirm';
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

  document.getElementById('type-filter').addEventListener('change', (e) => {
    setFilter({ type: e.target.value });
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
