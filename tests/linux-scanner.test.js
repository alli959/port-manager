const { parseSSLine, parseSSOutput } = require('../main/linux-scanner');

describe('Linux scanner - parseSSLine', () => {
  test('parses TCP LISTEN entry with source Linux', () => {
    const line = 'LISTEN   0        128            0.0.0.0:3000          0.0.0.0:*      users:(("node",pid=1234,fd=3))';
    const result = parseSSLine(line, 'TCP');
    expect(result).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '0.0.0.0',
      state: 'LISTEN',
      pid: 1234,
      processName: 'node',
      source: 'Linux',
      type: 'listen',
      mapping: null,
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: null,
      proxyType: null
    });
  });

  test('parses UDP entry with source Linux', () => {
    const line = 'UNCONN   0        0              0.0.0.0:53            0.0.0.0:*      users:(("dnsmasq",pid=1001,fd=4))';
    const result = parseSSLine(line, 'UDP');
    expect(result.source).toBe('Linux');
    expect(result.protocol).toBe('UDP');
    expect(result.state).toBe('*');
  });

  test('returns null for short lines', () => {
    expect(parseSSLine('foo bar', 'TCP')).toBeNull();
  });
});

describe('Linux scanner - parseSSOutput', () => {
  test('parses standard ss output', () => {
    const output = [
      'State    Recv-Q   Send-Q     Local Address:Port     Peer Address:Port  Process',
      'LISTEN   0        128            0.0.0.0:8080          0.0.0.0:*      users:(("java",pid=2345,fd=5))'
    ].join('\n');

    const entries = parseSSOutput(output, 'TCP');
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('Linux');
    expect(entries[0].port).toBe(8080);
  });

  test('handles empty output', () => {
    expect(parseSSOutput('', 'TCP')).toEqual([]);
  });
});
