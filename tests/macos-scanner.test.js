const { parseLsofLine, parseLsofOutput } = require('../main/macos-scanner');

describe('parseLsofLine', () => {
  test('parses TCP LISTEN entry', () => {
    const line = 'node      1234 user   12u  IPv4 0x123  0t0  TCP 127.0.0.1:3000 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 1234,
      processName: 'node',
      source: 'macOS',
      type: 'listen',
      mapping: null,
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: null,
      proxyType: null
    });
  });

  test('parses wildcard address', () => {
    const line = 'nginx     5678 root   6u  IPv4 0x456  0t0  TCP *:80 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result.localAddress).toBe('0.0.0.0');
    expect(result.port).toBe(80);
  });

  test('parses IPv6 address', () => {
    const line = 'node      9999 user   12u  IPv6 0x789  0t0  TCP [::1]:8080 (LISTEN)';
    const result = parseLsofLine(line);
    expect(result.localAddress).toBe('::1');
    expect(result.port).toBe(8080);
  });

  test('skips ESTABLISHED connections', () => {
    const line = 'node      1234 user   12u  IPv4 0x123  0t0  TCP 127.0.0.1:3000->127.0.0.1:4000 (ESTABLISHED)';
    const result = parseLsofLine(line);
    expect(result).toBeNull();
  });

  test('parses UDP entry', () => {
    const line = 'dnsmasq   1001 root   4u  IPv4 0xabc  0t0  UDP *:53';
    const result = parseLsofLine(line);
    expect(result.protocol).toBe('UDP');
    expect(result.state).toBe('*');
    expect(result.localAddress).toBe('0.0.0.0');
  });

  test('returns null for short lines', () => {
    expect(parseLsofLine('foo bar')).toBeNull();
  });
});

describe('parseLsofOutput', () => {
  test('parses full lsof output with header', () => {
    const output = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node      1234 user   12u  IPv4 0x123  0t0  TCP 127.0.0.1:3000 (LISTEN)',
      'postgres  5678 user   6u  IPv4 0x456  0t0  TCP 127.0.0.1:5432 (LISTEN)'
    ].join('\n');

    const entries = parseLsofOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0].port).toBe(3000);
    expect(entries[1].port).toBe(5432);
  });

  test('handles empty output', () => {
    expect(parseLsofOutput('')).toEqual([]);
  });
});
