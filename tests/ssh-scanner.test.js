const { parseSSHForwards, parseLocalForward, parseDynamicForward, resolveBindAddress } = require('../main/ssh-scanner');

describe('resolveBindAddress', () => {
  test('null returns 127.0.0.1 (loopback)', () => {
    expect(resolveBindAddress(null)).toBe('127.0.0.1');
  });

  test('undefined returns 127.0.0.1', () => {
    expect(resolveBindAddress(undefined)).toBe('127.0.0.1');
  });

  test('empty string returns 0.0.0.0', () => {
    expect(resolveBindAddress('')).toBe('0.0.0.0');
  });

  test(': returns 0.0.0.0', () => {
    expect(resolveBindAddress(':')).toBe('0.0.0.0');
  });

  test('* returns 0.0.0.0', () => {
    expect(resolveBindAddress('*')).toBe('0.0.0.0');
  });

  test('[::1] returns ::1', () => {
    expect(resolveBindAddress('[::1]')).toBe('::1');
  });

  test('explicit address passes through', () => {
    expect(resolveBindAddress('192.168.1.1')).toBe('192.168.1.1');
  });
});

describe('parseLocalForward', () => {
  test('parses -L port:host:hostport (no bind)', () => {
    const result = parseLocalForward('3000:localhost:4000', 5678);
    expect(result).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 5678,
      processName: 'ssh',
      source: 'SSH',
      type: 'forward',
      mapping: '→ localhost:4000',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: 'localhost:4000',
      proxyType: null
    });
  });

  test('parses -L with explicit bind address', () => {
    const result = parseLocalForward('0.0.0.0:3000:remotehost:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
    expect(result.port).toBe(3000);
    expect(result.mapping).toBe('→ remotehost:4000');
  });

  test('parses -L with wildcard * bind', () => {
    const result = parseLocalForward('*:3000:host:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
  });

  test('parses -L with empty bind (all interfaces)', () => {
    const result = parseLocalForward(':3000:host:4000', 1234);
    expect(result.localAddress).toBe('0.0.0.0');
  });

  test('parses -L with IPv6 bind', () => {
    const result = parseLocalForward('[::1]:3000:host:4000', 1234);
    expect(result.localAddress).toBe('::1');
  });
});

describe('parseDynamicForward', () => {
  test('parses -D port (SOCKS, no bind)', () => {
    const result = parseDynamicForward('1080', 5678);
    expect(result).toEqual({
      port: 1080,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 5678,
      processName: 'ssh',
      source: 'SSH',
      type: 'forward',
      mapping: 'SOCKS proxy',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: 'SOCKS proxy',
      proxyType: null
    });
  });

  test('parses -D with bind address', () => {
    const result = parseDynamicForward('0.0.0.0:1080', 5678);
    expect(result.localAddress).toBe('0.0.0.0');
    expect(result.port).toBe(1080);
  });
});

describe('parseSSHForwards', () => {
  test('extracts -L forwards from cmdline', () => {
    const cmdline = 'ssh -L 3000:localhost:4000 -L 8080:db:5432 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(2);
    expect(result[0].port).toBe(3000);
    expect(result[1].port).toBe(8080);
    expect(result[1].mapping).toBe('→ db:5432');
  });

  test('extracts -D SOCKS proxy from cmdline', () => {
    const cmdline = 'ssh -D 1080 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(1);
    expect(result[0].mapping).toBe('SOCKS proxy');
  });

  test('ignores -R flags', () => {
    const cmdline = 'ssh -R 4000:localhost:3000 -L 8080:host:80 user@remote';
    const result = parseSSHForwards(cmdline, 1234);
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(8080);
  });

  test('returns empty for no forwarding flags', () => {
    const cmdline = 'ssh user@host';
    const result = parseSSHForwards(cmdline, 1234);
    expect(result).toEqual([]);
  });

  test('handles mixed -L and -D', () => {
    const cmdline = 'ssh -L 3000:web:80 -D 1080 user@host';
    const result = parseSSHForwards(cmdline, 5678);
    expect(result).toHaveLength(2);
  });
});
