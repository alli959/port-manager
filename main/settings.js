const Store = require('electron-store');

const DEFAULTS = {
  theme: 'dark',
  refreshInterval: 5000,
  confirmBeforeStop: true
};

const VALID_INTERVALS = [0, 1000, 3000, 5000, 10000, 30000];
const VALID_THEMES = ['dark', 'light', 'system'];

let store;

function initSettings() {
  store = new Store({
    name: 'port-manager-settings',
    defaults: DEFAULTS
  });
  return store;
}

function getSettings() {
  if (!store) initSettings();
  return {
    theme: store.get('theme'),
    refreshInterval: store.get('refreshInterval'),
    confirmBeforeStop: store.get('confirmBeforeStop')
  };
}

function setSettings(partial) {
  if (!store) initSettings();

  if (partial.theme !== undefined && VALID_THEMES.includes(partial.theme)) {
    store.set('theme', partial.theme);
  }
  if (partial.refreshInterval !== undefined && VALID_INTERVALS.includes(partial.refreshInterval)) {
    store.set('refreshInterval', partial.refreshInterval);
  }
  if (typeof partial.confirmBeforeStop === 'boolean') {
    store.set('confirmBeforeStop', partial.confirmBeforeStop);
  }

  return getSettings();
}

module.exports = { initSettings, getSettings, setSettings, DEFAULTS };
