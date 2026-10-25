/**
 * Security Scanners Verification Test
 * 
 * This file verifies the functionality of the Infrastructure Scanners
 * (Docker, Kubernetes, Network) by mocking the underlying dependencies.
 */

// Mock dependencies
const mockDocker = {
    getContainer: jest.fn(),
    getImage: jest.fn()
};

const mockK8s = {
    KubeConfig: jest.fn().mockImplementation(() => ({
        loadFromDefault: jest.fn(),
        makeApiClient: jest.fn()
    })),
    CoreV1Api: {},
    AppsV1Api: {}
};

const mockSocket = {
    setTimeout: jest.fn(),
    on: jest.fn(),
    connect: jest.fn(),
    destroy: jest.fn()
};

// Mock modules
jest.mock('dockerode', () => {
    return jest.fn().mockImplementation(() => mockDocker);
});

jest.mock('@kubernetes/client-node', () => mockK8s);

jest.mock('net', () => ({
    Socket: jest.fn().mockImplementation(() => mockSocket)
}));

// Import Security Test Manager (Assuming it's exported or we mock the window global if it's browser-bound)
// Since the file assigns to window, we need to mock window
global.window = {};
require('./security-testing.js');
const { SecurityTestManager } = global.window;

describe('Infrastructure Scanners', () => {
    let manager;

    beforeEach(() => {
        manager = new SecurityTestManager();
        jest.clearAllMocks();
    });

    describe('Docker Scanner', () => {
        test('scanContainer detects running as root', async () => {
            // Setup Mock
            mockDocker.getContainer.mockReturnValue({
                inspect: jest.fn().mockResolvedValue({
                    Config: { User: 'root' },
                    HostConfig: { Privileged: false, ReadonlyRootfs: true }
                })
            });

            // Run Scan
            const scanner = manager.scanners.get('docker');
            const results = await scanner.scanContainer('test-container');

            // Verify
            expect(results).toHaveLength(1);
            expect(results[0].severity).toBe('HIGH');
            expect(results[0].description).toContain('root');
        });

        test('scanContainer detects privileged mode', async () => {
            mockDocker.getContainer.mockReturnValue({
                inspect: jest.fn().mockResolvedValue({
                    Config: { User: '1000' },
                    HostConfig: { Privileged: true, ReadonlyRootfs: true }
                })
            });

            const scanner = manager.scanners.get('docker');
            const results = await scanner.scanContainer('test-container');

            expect(results).toHaveLength(1);
            expect(results[0].severity).toBe('CRITICAL');
        });
    });

    describe('K8s Scanner', () => {
        test('scanYaml detects privileged pods', () => {
            const yaml = `
apiVersion: v1
kind: Pod
metadata:
  name: bad-pod
spec:
  containers:
  - name: heavy
    securityContext:
      privileged: true
            `;

            const scanner = manager.scanners.get('kubernetes');
            const results = scanner.scanYaml(yaml);

            expect(results).toHaveLength(2); // Privileged + Missing Limits
            expect(results.find(r => r.severity === 'CRITICAL')).toBeDefined();
        });
    });

    describe('Network Scanner', () => {
        test('scanPort reports open ports', async () => {
            // Setup Mock Socket to simulate connection
            mockSocket.on.mockImplementation((event, callback) => {
                if (event === 'connect') callback();
                return mockSocket;
            });

            const scanner = manager.scanners.get('network');
            const result = await scanner.scanPort('localhost', 8080);

            expect(result).not.toBeNull();
            expect(result.status).toBe('OPEN');
        });

        test('scanPort handles closed ports (timeout)', async () => {
            // Setup Mock Socket to simulate timeout
            mockSocket.on.mockImplementation((event, callback) => {
                if (event === 'timeout') callback();
                return mockSocket;
            });

            const scanner = manager.scanners.get('network');
            const result = await scanner.scanPort('localhost', 8080);

            expect(result).toBeNull();
        });
    });
});
