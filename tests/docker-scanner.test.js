const { parseDockerPorts, parseDockerPsLine } = require('../main/docker-scanner');

describe('parseDockerPorts', () => {
  test('parses single TCP port mapping', () => {
    const result = parseDockerPorts('0.0.0.0:3000->4000/tcp', 'my-app', 'nginx:latest', 'abc123def456');
    expect(result).toEqual([{
      port: 3000,
      protocol: 'TCP',
      localAddress: '0.0.0.0',
      state: 'LISTEN',
      pid: null,
      processName: 'my-app (nginx:latest)',
      source: 'Docker',
      type: 'forward',
      mapping: '→ 4000',
      containerName: 'my-app',
      containerImage: 'nginx:latest',
      containerId: 'abc123def456',
      tunnelTarget: null,
      proxyType: null
    }]);
  });

  test('parses UDP port mapping', () => {
    const result = parseDockerPorts('0.0.0.0:5353->5353/udp', 'dns', 'coredns:1.9', 'def456abc789');
    expect(result[0].protocol).toBe('UDP');
    expect(result[0].mapping).toBe('→ 5353');
  });

  test('parses IPv6 port mapping', () => {
    const result = parseDockerPorts(':::3000->4000/tcp', 'app', 'node:18', 'aaa111bbb222');
    expect(result[0].localAddress).toBe('::');
    expect(result[0].port).toBe(3000);
  });

  test('skips exposed-only ports (no host mapping)', () => {
    const result = parseDockerPorts('4000/tcp', 'app', 'node:18', 'aaa111bbb222');
    expect(result).toEqual([]);
  });

  test('parses port range into individual entries', () => {
    const result = parseDockerPorts('0.0.0.0:8000-8002->8000-8002/tcp', 'app', 'img:1', 'ccc333ddd444');
    expect(result).toHaveLength(3);
    expect(result[0].port).toBe(8000);
    expect(result[0].mapping).toBe('→ 8000');
    expect(result[1].port).toBe(8001);
    expect(result[2].port).toBe(8002);
  });

  test('parses comma-separated multi-mapping', () => {
    const result = parseDockerPorts(
      '0.0.0.0:3000->4000/tcp, :::3000->4000/tcp',
      'app', 'nginx:latest', 'abc123def456'
    );
    expect(result).toHaveLength(2);
    expect(result[0].localAddress).toBe('0.0.0.0');
    expect(result[1].localAddress).toBe('::');
  });

  test('returns empty array for empty ports string', () => {
    const result = parseDockerPorts('', 'app', 'img:1', 'abc123');
    expect(result).toEqual([]);
  });

  test('defaults to TCP when protocol suffix is missing', () => {
    const result = parseDockerPorts('0.0.0.0:3000->4000', 'app', 'img:1', 'abc123def456');
    expect(result[0].protocol).toBe('TCP');
  });
});

describe('parseDockerPsLine', () => {
  test('parses full docker ps JSON line', () => {
    const json = {
      Names: 'my-app',
      Image: 'nginx:latest',
      ID: 'abc123def456',
      Ports: '0.0.0.0:3000->4000/tcp, :::3000->4000/tcp'
    };
    const result = parseDockerPsLine(JSON.stringify(json));
    expect(result).toHaveLength(2);
    expect(result[0].containerName).toBe('my-app');
  });

  test('returns empty array for container with no published ports', () => {
    const json = { Names: 'db', Image: 'postgres:16', ID: 'fff999aaa111', Ports: '' };
    const result = parseDockerPsLine(JSON.stringify(json));
    expect(result).toEqual([]);
  });
});
