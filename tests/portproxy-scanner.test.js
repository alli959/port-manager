const { parsePortProxyOutput } = require('../main/portproxy-scanner');

describe('parsePortProxyOutput', () => {
  test('parses v4tov4 rules', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000
*               8080        172.28.176.1    8080
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      port: 3000,
      protocol: 'TCP',
      localAddress: '0.0.0.0',
      state: 'FORWARD',
      pid: null,
      processName: 'netsh portproxy',
      source: 'PortProxy',
      type: 'forward',
      mapping: '→ 172.28.176.1:3000',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: '172.28.176.1:3000',
      proxyType: 'v4tov4'
    });
    expect(result[1].localAddress).toBe('0.0.0.0');
    expect(result[1].port).toBe(8080);
    expect(result[1].proxyType).toBe('v4tov4');
  });

  test('parses v6tov4 rules', () => {
    const output = `
Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              9090        172.28.176.1    9090
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].localAddress).toBe('::');
    expect(result[0].proxyType).toBe('v6tov4');
  });

  test('parses mixed sections', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         3000        172.28.176.1    3000

Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              9090        172.28.176.1    9090
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].proxyType).toBe('v4tov4');
    expect(result[1].proxyType).toBe('v6tov4');
  });

  test('returns empty array for empty output', () => {
    expect(parsePortProxyOutput('')).toEqual([]);
  });

  test('returns empty array for header-only output', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
`;
    expect(parsePortProxyOutput(output)).toEqual([]);
  });

  test('normalizes * to 0.0.0.0 in IPv4 sections', () => {
    const output = `
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
*               5000        10.0.0.1        5000
`;
    const result = parsePortProxyOutput(output);
    expect(result[0].localAddress).toBe('0.0.0.0');
  });

  test('parses v4tov6 rules', () => {
    const output = `
Listen on ipv4:             Connect to ipv6:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
0.0.0.0         7000        ::1             7000
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].proxyType).toBe('v4tov6');
    expect(result[0].mapping).toBe('→ ::1:7000');
  });

  test('parses v6tov6 rules', () => {
    const output = `
Listen on ipv6:             Connect to ipv6:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
::              4000        ::1             4000
`;
    const result = parsePortProxyOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].proxyType).toBe('v6tov6');
    expect(result[0].localAddress).toBe('::');
  });

  test('normalizes * to :: in IPv6 listen sections', () => {
    const output = `
Listen on ipv6:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
*               6000        10.0.0.1        6000
`;
    const result = parsePortProxyOutput(output);
    expect(result[0].localAddress).toBe('::');
  });
});
