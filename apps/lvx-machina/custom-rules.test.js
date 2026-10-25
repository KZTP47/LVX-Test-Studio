/**
 * Verification of Custom Rules Loading
 */

// Mock dependencies (minimal for SAST)
jest.mock('dockerode', () => jest.fn());
jest.mock('@kubernetes/client-node', () => ({
    KubeConfig: jest.fn(),
    CoreV1Api: {},
    AppsV1Api: {}
}));
jest.mock('net', () => ({ Socket: jest.fn() }));

global.window = {};
require('./security-testing.js');
const { SecurityTestManager } = global.window;

describe('Custom Rules Extensibility', () => {
    test('loadCustomRules adds new patterns', () => {
        const manager = new SecurityTestManager(); // Re-init

        const customRules = {
            javascript: [
                {
                    id: 'CUSTOM001',
                    name: 'Forbidden Variable',
                    severity: 'CRITICAL',
                    pattern: 'forbidden_var', // String pattern to test conversion
                    description: 'Testing custom rules',
                    recommendation: 'Remove it'
                }
            ]
        };

        manager.loadCustomRules(customRules);

        const code = 'const x = forbidden_var;';
        const results = manager.scanners.get('sast').scan(code, 'javascript');

        expect(results).toHaveLength(1);
        expect(results[0].ruleId).toBe('CUSTOM001');
    });
});
