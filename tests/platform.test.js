const fs = require('fs');

jest.mock('fs');

// We need to re-require platform.js for each test to reset module state
function loadPlatform() {
  jest.resetModules();
  jest.mock('fs');
  return require('../main/platform');
}

describe('getPlatform', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  test('returns macos on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { getPlatform } = loadPlatform();
    expect(getPlatform()).toBe('macos');
  });

  test('returns windows on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { getPlatform } = loadPlatform();
    expect(getPlatform()).toBe('windows');
  });

  test('returns wsl when /proc/version contains microsoft', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockReturnValue('Linux version 5.15.0-1-microsoft-standard-WSL2');
    expect(getPlatform()).toBe('wsl');
  });

  test('returns linux when /proc/version does not contain microsoft', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockReturnValue('Linux version 6.1.0-generic');
    expect(getPlatform()).toBe('linux');
  });

  test('returns linux when /proc/version cannot be read', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { getPlatform } = loadPlatform();
    const fs = require('fs');
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(getPlatform()).toBe('linux');
  });
});
