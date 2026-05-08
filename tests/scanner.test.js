const {
  parseSSOutput,
  parseSSLine
} = require('../main/scanner');

describe('parseSSOutput - TCP', () => {
  test('parses standard ss -tlnp output', () => {
    const output = [
      'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process',
      'LISTEN   0        128            0.0.0.0:3000          0.0.0.0:*      users:(("node",pid=1234,fd=3))',
      'LISTEN   0        128          127.0.0.1:5432          0.0.0.0:*      users:(("postgres",pid=5678,fd=6))'
    ].join('\n');

    const entries = parseSSOutput(output, 'TCP');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '0.0.0.0',
      state: 'LISTEN',
      pid: 1234,
      processName: 'node',
      source: 'WSL'
    });
    expect(entries[1]).toEqual({
      port: 5432,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 5678,
      processName: 'postgres',
      source: 'WSL'
    });
  });

  test('handles IPv6 addresses', () => {
    const output = [
      'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process',
      'LISTEN   0        128               [::]:80              [::]:*      users:(("nginx",pid=9999,fd=6))'
    ].join('\n');

    const entries = parseSSOutput(output, 'TCP');
    expect(entries).toHaveLength(1);
    expect(entries[0].localAddress).toBe('[::]');
    expect(entries[0].port).toBe(80);
    expect(entries[0].processName).toBe('nginx');
  });

  test('handles missing PID (no users field)', () => {
    const output = [
      'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process',
      'LISTEN   0        128            0.0.0.0:53            0.0.0.0:*'
    ].join('\n');

    const entries = parseSSOutput(output, 'TCP');
    expect(entries).toHaveLength(1);
    expect(entries[0].pid).toBeNull();
    expect(entries[0].processName).toBe('<unknown>');
  });

  test('handles empty output (header only)', () => {
    const output = 'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process';
    const entries = parseSSOutput(output, 'TCP');
    expect(entries).toHaveLength(0);
  });

  test('handles completely empty output', () => {
    const entries = parseSSOutput('', 'TCP');
    expect(entries).toHaveLength(0);
  });
});

describe('parseSSOutput - UDP', () => {
  test('parses standard ss -ulnp output', () => {
    const output = [
      'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process',
      'UNCONN   0        0              0.0.0.0:53            0.0.0.0:*      users:(("dnsmasq",pid=1001,fd=4))'
    ].join('\n');

    const entries = parseSSOutput(output, 'UDP');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      port: 53,
      protocol: 'UDP',
      localAddress: '0.0.0.0',
      state: '*',
      pid: 1001,
      processName: 'dnsmasq',
      source: 'WSL'
    });
  });
});

describe('parseSSLine', () => {
  test('returns null for short lines', () => {
    expect(parseSSLine('foo bar', 'TCP')).toBeNull();
  });

  test('returns null for malformed address', () => {
    expect(parseSSLine('LISTEN 0 128 noport 0.0.0.0:*', 'TCP')).toBeNull();
  });
});
