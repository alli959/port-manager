// Mock child_process BEFORE requiring scanner
jest.mock('child_process', () => {
  const original = jest.requireActual('child_process');
  return {
    ...original,
    exec: jest.fn()
  };
});

jest.mock('../main/platform', () => ({
  getPlatform: jest.fn(() => 'wsl')
}));

const { exec } = require('child_process');
const { getPlatform } = require('../main/platform');
const { scanWindows, scanPorts, getScanners } = require('../main/scanner');

describe('getScanners', () => {
  test('wsl returns WSL and Windows scanners', () => {
    const scanners = getScanners('wsl');
    const names = scanners.map(s => s.name);
    expect(names).toContain('WSL');
    expect(names).toContain('Windows');
  });

  test('windows returns only Windows scanner', () => {
    const scanners = getScanners('windows');
    const names = scanners.map(s => s.name);
    expect(names).toContain('Windows');
    expect(names).not.toContain('WSL');
  });

  test('unknown platform still includes cross-platform scanners', () => {
    const scanners = getScanners('unknown');
    const names = scanners.map(s => s.name);
    expect(names).toContain('Docker');
    expect(names).toContain('SSH');
    expect(names).toContain('Kubernetes');
    expect(names).not.toContain('WSL');
    expect(names).not.toContain('Windows');
  });
});

describe('scanPorts orchestration', () => {
  beforeEach(() => {
    exec.mockReset();
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; }
      cb(new Error(`unmocked command: ${cmd}`));
    });
  });

  test('returns ports from both sources on success', async () => {
    const ssTcp = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process\nLISTEN   0        128            0.0.0.0:3000          0.0.0.0:*      users:(("node",pid=1234,fd=3))';
    const ssUdp = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process\n';

    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (cmd.includes('ss -tlnp')) return cb(null, { stdout: ssTcp, stderr: '' });
      if (cmd.includes('ss -ulnp')) return cb(null, { stdout: ssUdp, stderr: '' });
      if (cmd.includes('Get-NetTCPConnection')) return cb(null, { stdout: '[]', stderr: '' });
      if (cmd.includes('Get-NetUDPEndpoint')) return cb(null, { stdout: '[]', stderr: '' });
      if (cmd.includes('docker ps')) return cb(null, { stdout: '', stderr: '' });
      if (cmd.includes('grep')) { const e = new Error(''); e.code = 1; return cb(e, { stdout: '', stderr: '' }); }
      if (cmd.includes('portproxy')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected command'));
    });

    const result = await scanPorts();
    expect(result.ports.length).toBeGreaterThanOrEqual(1);
    expect(result.errors).toEqual([]);
  });

  test('returns partial results when one source fails', async () => {
    const ssTcp = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process\nLISTEN   0        128            0.0.0.0:3000          0.0.0.0:*      users:(("node",pid=1234,fd=3))';

    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (cmd.includes('ss -tlnp')) return cb(null, { stdout: ssTcp, stderr: '' });
      if (cmd.includes('ss -ulnp')) return cb(null, { stdout: '', stderr: '' });
      if (cmd.includes('Get-NetTCPConnection')) return cb(new Error('PowerShell not found'));
      if (cmd.includes('Get-NetUDPEndpoint')) return cb(new Error('PowerShell not found'));
      if (cmd.includes('docker ps')) return cb(null, { stdout: '', stderr: '' });
      if (cmd.includes('grep')) { const e = new Error(''); e.code = 1; return cb(e, { stdout: '', stderr: '' }); }
      if (cmd.includes('portproxy')) return cb(null, { stdout: '', stderr: '' });
      cb(new Error('unexpected'));
    });

    const result = await scanPorts();
    expect(result.ports.length).toBe(1);
    expect(result.ports[0].source).toBe('WSL');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].source).toBe('Windows');
  });

  test('returns errors for all sources when all fail', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      cb(new Error('command not found'));
    });

    const result = await scanPorts();
    expect(result.ports).toEqual([]);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('scanWindows', () => {
  test('normalizes singleton JSON and resolves process names', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (cmd.includes('Get-NetTCPConnection')) {
        return cb(null, {
          stdout: '{"LocalAddress":"0.0.0.0","LocalPort":80,"State":2,"OwningProcess":4}',
          stderr: ''
        });
      }
      if (cmd.includes('Get-NetUDPEndpoint')) {
        return cb(null, {
          stdout: '{"LocalAddress":"0.0.0.0","LocalPort":53,"OwningProcess":1001}',
          stderr: ''
        });
      }
      if (cmd.includes('Get-Process -Id 4,1001')) {
        return cb(null, {
          stdout: '[{"Id":4,"ProcessName":"System"},{"Id":1001,"ProcessName":"dnsmasq"}]',
          stderr: ''
        });
      }
      return cb(new Error(`unexpected command: ${cmd}`));
    });

    const entries = await scanWindows();
    expect(entries).toEqual([
      {
        port: 80,
        protocol: 'TCP',
        localAddress: '0.0.0.0',
        state: 'LISTEN',
        pid: 4,
        processName: 'System',
        source: 'Windows',
        type: 'listen',
        mapping: null,
        containerName: null,
        containerImage: null,
        containerId: null,
        tunnelTarget: null,
        proxyType: null
      },
      {
        port: 53,
        protocol: 'UDP',
        localAddress: '0.0.0.0',
        state: '*',
        pid: 1001,
        processName: 'dnsmasq',
        source: 'Windows',
        type: 'listen',
        mapping: null,
        containerName: null,
        containerImage: null,
        containerId: null,
        tunnelTarget: null,
        proxyType: null
      }
    ]);
  });

  test('keeps unknown names when process lookup fails', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (cmd.includes('Get-NetTCPConnection')) {
        return cb(null, {
          stdout: '[{"LocalAddress":"127.0.0.1","LocalPort":3000,"State":2,"OwningProcess":1234}]',
          stderr: ''
        });
      }
      if (cmd.includes('Get-NetUDPEndpoint')) {
        return cb(null, { stdout: '[]', stderr: '' });
      }
      if (cmd.includes('Get-Process -Id 1234')) {
        return cb(new Error('lookup failed'));
      }
      return cb(new Error(`unexpected command: ${cmd}`));
    });

    const entries = await scanWindows();
    expect(entries).toEqual([
      {
        port: 3000,
        protocol: 'TCP',
        localAddress: '127.0.0.1',
        state: 'LISTEN',
        pid: 1234,
        processName: '<unknown>',
        source: 'Windows',
        type: 'listen',
        mapping: null,
        containerName: null,
        containerImage: null,
        containerId: null,
        tunnelTarget: null,
        proxyType: null
      }
    ]);
  });
});
