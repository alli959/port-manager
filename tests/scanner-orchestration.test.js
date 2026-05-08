// Mock child_process BEFORE requiring scanner
jest.mock('child_process', () => {
  const original = jest.requireActual('child_process');
  return {
    ...original,
    exec: jest.fn()
  };
});

const { exec } = require('child_process');
const { scanPorts } = require('../main/scanner');

describe('scanPorts orchestration', () => {
  beforeEach(() => {
    exec.mockReset();
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
      if (cmd.includes('powershell')) return cb(new Error('PowerShell not found'));
      cb(new Error('unexpected'));
    });

    const result = await scanPorts();
    expect(result.ports.length).toBe(1);
    expect(result.ports[0].source).toBe('WSL');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].source).toBe('Windows');
  });

  test('returns errors for both sources when both fail', async () => {
    exec.mockImplementation((cmd, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      cb(new Error('command not found'));
    });

    const result = await scanPorts();
    expect(result.ports).toEqual([]);
    expect(result.errors).toHaveLength(2);
  });
});
