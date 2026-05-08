let settingsOpen = false;

function openSettings() {
  const panel = document.getElementById('settings-panel');
  panel.style.display = 'flex';
  settingsOpen = true;
}

function closeSettings() {
  const panel = document.getElementById('settings-panel');
  panel.style.display = 'none';
  settingsOpen = false;
}

function populateSettings(settings) {
  document.getElementById('theme-select').value = settings.theme;
  document.getElementById('refresh-select').value = String(settings.refreshInterval);
  document.getElementById('confirm-toggle').checked = settings.confirmBeforeStop;
}

function initSettingsUI() {
  document.getElementById('settings-btn').addEventListener('click', () => {
    if (settingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  document.getElementById('settings-close').addEventListener('click', closeSettings);

  document.getElementById('theme-select').addEventListener('change', (e) => {
    window.portManager.setSettings({ theme: e.target.value });
  });

  document.getElementById('refresh-select').addEventListener('change', (e) => {
    window.portManager.setSettings({ refreshInterval: parseInt(e.target.value, 10) });
  });

  document.getElementById('confirm-toggle').addEventListener('change', (e) => {
    window.portManager.setSettings({ confirmBeforeStop: e.target.checked });
  });
}
