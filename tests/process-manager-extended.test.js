jest.mock('child_process', () => ({
  execSync: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../main/platform', () => ({ getPlatform: jest.fn(() => 'wsl') }));

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const { killProcess, validateContainerId, validatePortProxyRule } = require('../main/process-manager');

// Mock promisify to use our mocked exec
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn((fn) => {
    if (fn === require('child_process').exec) {
      return (...args) => new Promise((resolve, reject) => {
        const cb = (err, result) => err ? reject(err) : resolve(result);
        fn(...args, cb);
      });
    }
    return jest.requireActual('util').promisify(fn);
  })
}));

describe('validateContainerId', () => {
  test('accepts valid 12-char hex ID', () => {
    expect(() => validateContainerId('abc123def456')).not.toThrow();
  });

  test('accepts long hex ID', () => {
    expect(() => validateContainerId('abc123def456abc123def456abc123def456abc123def456abc123def456abcd')).not.toThrow();
  });

  test('rejects short ID', () => {
    expect(() => validateContainerId('abc123')).toThrow();
  });

  test('rejects non-hex characters', () => {
    expect(() => validateContainerId('abc123def45g')).toThrow();
  });

  test('rejects empty string', () => {
    expect(() => validateContainerId('')).toThrow();
  });
});

describe('validatePortProxyRule', () => {
  test('accepts valid IPv4 rule', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'v4tov4' })).not.toThrow();
  });

  test('accepts valid IPv6 rule', () => {
    expect(() => validatePortProxyRule({ listenAddress: '::', listenPort: 9090, proxyType: 'v6tov4' })).not.toThrow();
  });

  test('accepts specific IPv4 address', () => {
    expect(() => validatePortProxyRule({ listenAddress: '192.168.1.1', listenPort: 80, proxyType: 'v4tov4' })).not.toThrow();
  });

  test('rejects invalid port', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 99999, proxyType: 'v4tov4' })).toThrow();
  });

  test('rejects invalid proxyType', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'invalid' })).toThrow();
  });

  test('rejects missing listenAddress', () => {
    expect(() => validatePortProxyRule({ listenPort: 3000, proxyType: 'v4tov4' })).toThrow();
  });

  test('rejects listenAddress with shell metacharacters', () => {
    expect(() => validatePortProxyRule({ listenAddress: '0.0.0.0; rm -rf /', listenPort: 3000, proxyType: 'v4tov4' })).toThrow();
  });
});

describe('killProcess - Docker', () => {
  beforeEach(() => { execSync.mockReset(); exec.mockReset(); });

  test('stops Docker container with docker stop then succeeds', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      if (cmd.includes('docker stop')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({ pid: null, source: 'Docker', containerId: 'abc123def456' });
    expect(result.success).toBe(true);
  });

  test('escalates to docker kill if docker stop fails', async () => {
    let callCount = 0;
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      callCount++;
      if (cmd.includes('docker stop')) return cb(new Error('timeout'));
      if (cmd.includes('docker kill')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({ pid: null, source: 'Docker', containerId: 'abc123def456' });
    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });

  test('returns error when missing containerId', async () => {
    const result = await killProcess({ pid: null, source: 'Docker' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing containerId');
  });
});

describe('killProcess - PortProxy', () => {
  beforeEach(() => { execSync.mockReset(); exec.mockReset(); });

  test('deletes portproxy rule via powershell on WSL', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      if (cmd.includes('netsh interface portproxy delete')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await killProcess({
      pid: null,
      source: 'PortProxy',
      portproxyRule: { listenAddress: '0.0.0.0', listenPort: 3000, proxyType: 'v4tov4' }
    });
    expect(result.success).toBe(true);
  });

  test('returns error when missing portproxy rule', async () => {
    const result = await killProcess({ pid: null, source: 'PortProxy' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing portproxy rule');
  });
});

describe('killProcess - SSH/Kubernetes (kill by PID)', () => {
  beforeEach(() => execSync.mockReset());

  test('kills SSH process with kill -9', async () => {
    execSync.mockReturnValue('');
    const result = await killProcess({ pid: 5678, source: 'SSH' });
    expect(execSync).toHaveBeenCalledWith('kill -9 5678', { stdio: 'pipe' });
    expect(result.success).toBe(true);
  });

  test('kills Kubernetes process with kill -9', async () => {
    execSync.mockReturnValue('');
    const result = await killProcess({ pid: 9999, source: 'Kubernetes' });
    expect(execSync).toHaveBeenCalledWith('kill -9 9999', { stdio: 'pipe' });
    expect(result.success).toBe(true);
  });
});
