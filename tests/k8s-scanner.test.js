const { parsePortForwardArgs } = require('../main/k8s-scanner');

describe('parsePortForwardArgs', () => {
  test('parses simple port-forward with pod', () => {
    const cmdline = 'kubectl port-forward pod/my-pod 8080:80';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      port: 8080,
      protocol: 'TCP',
      localAddress: '127.0.0.1',
      state: 'LISTEN',
      pid: 1234,
      processName: 'kubectl',
      source: 'Kubernetes',
      type: 'forward',
      mapping: '→ pod/my-pod:80',
      containerName: null,
      containerImage: null,
      containerId: null,
      tunnelTarget: 'pod/my-pod:80',
      proxyType: null
    });
  });

  test('parses service port-forward', () => {
    const cmdline = 'kubectl port-forward svc/my-service 3000:80 9090:9090';
    const result = parsePortForwardArgs(cmdline, 5678);
    expect(result).toHaveLength(2);
    expect(result[0].port).toBe(3000);
    expect(result[0].mapping).toBe('→ svc/my-service:80');
    expect(result[1].port).toBe(9090);
    expect(result[1].mapping).toBe('→ svc/my-service:9090');
  });

  test('parses --address flag with 0.0.0.0', () => {
    const cmdline = 'kubectl port-forward --address 0.0.0.0 pod/web 8080:80';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result[0].localAddress).toBe('0.0.0.0');
  });

  test('parses --address= flag syntax', () => {
    const cmdline = 'kubectl port-forward --address=0.0.0.0 pod/web 8080:80';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result[0].localAddress).toBe('0.0.0.0');
  });

  test('defaults to 127.0.0.1 when no --address', () => {
    const cmdline = 'kubectl port-forward deploy/api 5000:5000';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result[0].localAddress).toBe('127.0.0.1');
  });

  test('handles deployment resource', () => {
    const cmdline = 'kubectl port-forward deploy/my-app 3000:3000';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result[0].mapping).toBe('→ deploy/my-app:3000');
  });

  test('returns empty for non-port-forward kubectl', () => {
    const cmdline = 'kubectl get pods';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result).toEqual([]);
  });

  test('handles namespace flag without breaking parsing', () => {
    const cmdline = 'kubectl -n production port-forward svc/redis 6379:6379';
    const result = parsePortForwardArgs(cmdline, 1234);
    expect(result).toHaveLength(1);
    expect(result[0].port).toBe(6379);
  });
});
