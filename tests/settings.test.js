let mockData;

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    return {
      get: jest.fn((key) => mockData[key]),
      set: jest.fn((key, value) => { mockData[key] = value; })
    };
  });
});

const { initSettings, getSettings, setSettings, DEFAULTS } = require('../main/settings');

describe('settings', () => {
  beforeEach(() => {
    mockData = { ...DEFAULTS };
    initSettings();
  });

  test('returns default settings', () => {
    expect(getSettings()).toEqual({
      theme: 'dark',
      refreshInterval: 5000,
      confirmBeforeStop: true
    });
  });

  test('updates theme to valid value', () => {
    const result = setSettings({ theme: 'light' });
    expect(result.theme).toBe('light');
  });

  test('accepts system theme', () => {
    const result = setSettings({ theme: 'system' });
    expect(result.theme).toBe('system');
  });

  test('rejects invalid theme value', () => {
    setSettings({ theme: 'purple' });
    expect(getSettings().theme).toBe('dark');
  });

  test('updates refreshInterval to valid value', () => {
    setSettings({ refreshInterval: 10000 });
    expect(getSettings().refreshInterval).toBe(10000);
  });

  test('allows refreshInterval of 0 (off)', () => {
    setSettings({ refreshInterval: 0 });
    expect(getSettings().refreshInterval).toBe(0);
  });

  test('rejects invalid refreshInterval', () => {
    setSettings({ refreshInterval: 999 });
    expect(getSettings().refreshInterval).toBe(5000);
  });

  test('updates confirmBeforeStop', () => {
    setSettings({ confirmBeforeStop: false });
    expect(getSettings().confirmBeforeStop).toBe(false);
  });

  test('rejects non-boolean confirmBeforeStop', () => {
    setSettings({ confirmBeforeStop: 'yes' });
    expect(getSettings().confirmBeforeStop).toBe(true);
  });

  test('partial update preserves other settings', () => {
    setSettings({ theme: 'light' });
    const settings = getSettings();
    expect(settings.refreshInterval).toBe(5000);
    expect(settings.confirmBeforeStop).toBe(true);
  });
});
