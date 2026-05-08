const { killProcess, validatePid } = require('../main/process-manager');

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../main/platform', () => ({ getPlatform: jest.fn(() => 'wsl') }));

const { execSync } = require('child_process');

describe('validatePid', () => {
  test('accepts valid positive integer', () => {
    expect(() => validatePid(1234)).not.toThrow();
  });

  test('rejects string', () => {
    expect(() => validatePid('abc')).toThrow('Invalid PID');
  });

  test('rejects negative number', () => {
    expect(() => validatePid(-1)).toThrow('Invalid PID');
  });

  test('rejects zero', () => {
    expect(() => validatePid(0)).toThrow('Invalid PID');
  });

  test('rejects float', () => {
    expect(() => validatePid(1.5)).toThrow('Invalid PID');
  });

  test('rejects null', () => {
    expect(() => validatePid(null)).toThrow('Invalid PID');
  });
});

describe('killProcess', () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  test('kills WSL process with kill -9', async () => {
    execSync.mockReturnValue('');
    const result = await killProcess(1234, 'WSL');
    expect(execSync).toHaveBeenCalledWith('kill -9 1234', { stdio: 'pipe' });
    expect(result).toEqual({ success: true });
  });

  test('kills Windows process with Stop-Process -Force', async () => {
    execSync.mockReturnValue('');
    const result = await killProcess(5678, 'Windows');
    expect(execSync).toHaveBeenCalledWith(
      'powershell.exe -NoProfile -Command "Stop-Process -Id 5678 -Force"',
      { stdio: 'pipe' }
    );
    expect(result).toEqual({ success: true });
  });

  test('returns success when process already gone (WSL)', async () => {
    execSync.mockImplementation(() => { throw new Error('No such process'); });
    const result = await killProcess(1234, 'WSL');
    expect(result).toEqual({ success: true });
  });

  test('returns success when process already gone (Windows)', async () => {
    execSync.mockImplementation(() => { throw new Error('Cannot find a process with the process identifier'); });
    const result = await killProcess(1234, 'Windows');
    expect(result).toEqual({ success: true });
  });

  test('returns error for permission denied (WSL)', async () => {
    execSync.mockImplementation(() => { throw new Error('Operation not permitted'); });
    const result = await killProcess(1234, 'WSL');
    expect(result).toEqual({ success: false, error: 'Cannot stop — insufficient permissions' });
  });

  test('returns error for access denied (Windows)', async () => {
    execSync.mockImplementation(() => { throw new Error('Access is denied'); });
    const result = await killProcess(1234, 'Windows');
    expect(result).toEqual({ success: false, error: 'Cannot stop — insufficient permissions' });
  });

  test('kills Linux process with kill -9', async () => {
    execSync.mockReturnValue('');
    const result = await killProcess(1234, 'Linux');
    expect(execSync).toHaveBeenCalledWith('kill -9 1234', { stdio: 'pipe' });
    expect(result).toEqual({ success: true });
  });

  test('returns error for unknown source', async () => {
    const result = await killProcess(1234, 'UnknownOS');
    expect(result).toEqual({ success: false, error: 'Unknown source: UnknownOS' });
  });
});
