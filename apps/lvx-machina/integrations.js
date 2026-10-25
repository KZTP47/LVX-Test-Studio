/**
 * LVX-Machina Integration Manager
 * Handles notifications to external platforms (Slack, Discord, Email, Webhooks)
 */

class IntegrationsManager {
    constructor() {
        this.STORAGE_KEY = 'notification_integrations';
        this.HISTORY_KEY = 'notification_history';
        this.MAX_HISTORY = 100;
    }

    _getStorageApi() {
        if (typeof window !== 'undefined' && window.secureConfig) {
            return window.secureConfig;
        }

        return {
            saveConfig: (storageKey, value) => {
                localStorage.setItem(storageKey, JSON.stringify(value));
                return true;
            },
            loadConfig: (storageKey, defaultValue = null) => {
                const raw = localStorage.getItem(storageKey);
                return raw ? JSON.parse(raw) : defaultValue;
            },
            clearConfig: (storageKey) => localStorage.removeItem(storageKey)
        };
    }

    // Save integration configuration
    saveIntegration(integration) {
        const integrations = this.getAllIntegrations();
        integration.id = integration.id || this._generateId();
        integration.created = integration.created || new Date().toISOString();
        integration.modified = new Date().toISOString();
        integration.enabled = integration.enabled !== false; // Default to enabled

        const index = integrations.findIndex(i => i.id === integration.id);
        if (index >= 0) {
            integrations[index] = integration;
        } else {
            integrations.push(integration);
        }

        this._getStorageApi().saveConfig(this.STORAGE_KEY, integrations);
        return integration.id;
    }

    // Get all integrations
    getAllIntegrations() {
        return this._getStorageApi().loadConfig(this.STORAGE_KEY, []) || [];
    }

    // Get integration by ID
    getIntegration(id) {
        return this.getAllIntegrations().find(i => i.id === id);
    }

    // Get enabled integrations by type
    getEnabledIntegrations(type = null) {
        const integrations = this.getAllIntegrations().filter(i => i.enabled);
        return type ? integrations.filter(i => i.type === type) : integrations;
    }

    // Delete integration
    deleteIntegration(id) {
        const integrations = this.getAllIntegrations().filter(i => i.id !== id);
        this._getStorageApi().saveConfig(this.STORAGE_KEY, integrations);
    }

    // Toggle integration enabled/disabled
    toggleIntegration(id) {
        const integration = this.getIntegration(id);
        if (integration) {
            integration.enabled = !integration.enabled;
            this.saveIntegration(integration);
        }
        return integration?.enabled;
    }

    // Send notification to all enabled integrations
    async sendNotification(testResult) {
        const integrations = this.getEnabledIntegrations();

        if (integrations.length === 0) {
            console.log('No enabled integrations to notify');
            return { success: 0, failed: 0 };
        }

        const results = await Promise.allSettled(
            integrations.map(integration => this._sendToIntegration(integration, testResult))
        );

        const success = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`Notifications sent: ${success} succeeded, ${failed} failed`);

        return { success, failed, results };
    }

    // Send to specific integration
    async _sendToIntegration(integration, testResult) {
        console.log(`Sending notification via ${integration.type}...`);

        try {
            let result;
            switch (integration.type) {
                case 'slack':
                    result = await this._sendSlackNotification(integration, testResult);
                    break;
                case 'discord':
                    result = await this._sendDiscordNotification(integration, testResult);
                    break;
                case 'webhook':
                    result = await this._sendWebhookNotification(integration, testResult);
                    break;
                case 'email':
                    result = await this._sendEmailNotification(integration, testResult);
                    break;
                default:
                    throw new Error(`Unknown integration type: ${integration.type}`);
            }
            this.recordNotification(integration, testResult, true);
            return result;
        } catch (error) {
            this.recordNotification(integration, testResult, false, error);
            throw error;
        }
    }

    // Send Slack notification
    async _sendSlackNotification(integration, testResult) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Slack webhook URL not configured');

        const color = testResult.status === 'PASSED' ? '#4CAF50' : '#F44336';
        const emoji = testResult.status === 'PASSED' ? '✅' : '❌';

        const message = {
            username: 'LVX-Machina',
            icon_emoji: ':robot_face:',
            attachments: [{
                color: color,
                title: `${emoji} Test: ${testResult.suiteName}`,
                fields: [
                    {
                        title: 'Status',
                        value: testResult.status,
                        short: true
                    },
                    {
                        title: 'Duration',
                        value: `${testResult.executionTime}ms`,
                        short: true
                    },
                    {
                        title: 'Timestamp',
                        value: new Date(testResult.timestamp).toLocaleString(),
                        short: false
                    }
                ],
                footer: 'LVX-Machina Test Automation',
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        if (testResult.errorMessage) {
            message.attachments[0].fields.push({
                title: 'Error',
                value: testResult.errorMessage.substring(0, 200),
                short: false
            });
        }

        const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            throw new Error(`Slack notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'slack' };
    }

    // Send Discord notification
    async _sendDiscordNotification(integration, testResult) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Discord webhook URL not configured');

        const color = testResult.status === 'PASSED' ? 0x4CAF50 : 0xF44336;
        const emoji = testResult.status === 'PASSED' ? '✅' : '❌';

        const message = {
            username: 'LVX-Machina',
            avatar_url: 'https://via.placeholder.com/128/2196F3/FFFFFF?text=LVX',
            embeds: [{
                title: `${emoji} Test Execution: ${testResult.suiteName}`,
                color: color,
                fields: [
                    {
                        name: 'Status',
                        value: testResult.status,
                        inline: true
                    },
                    {
                        name: 'Duration',
                        value: `${testResult.executionTime}ms`,
                        inline: true
                    },
                    {
                        name: 'Timestamp',
                        value: new Date(testResult.timestamp).toLocaleString(),
                        inline: false
                    }
                ],
                footer: {
                    text: 'LVX-Machina Test Automation'
                },
                timestamp: new Date().toISOString()
            }]
        };

        if (testResult.errorMessage) {
            message.embeds[0].fields.push({
                name: 'Error',
                value: `\`\`\`\n${testResult.errorMessage.substring(0, 200)}\n\`\`\``,
                inline: false
            });
        }

        const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            throw new Error(`Discord notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'discord' };
    }

    // Send generic webhook notification
    async _sendWebhookNotification(integration, testResult) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Webhook URL not configured');

        const payload = {
            event: 'test_execution_completed',
            timestamp: new Date().toISOString(),
            test: {
                id: testResult.suiteId,
                name: testResult.suiteName,
                status: testResult.status,
                executionTime: testResult.executionTime,
                errorMessage: testResult.errorMessage,
                timestamp: testResult.timestamp
            }
        };

        const response = await fetch(webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'LVX-Machina/1.0'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'webhook' };
    }

    // Send email notification (using mailto or email service API)
    async _sendEmailNotification(integration, testResult) {
        // For browser-based app, we'll use mailto: links
        // In production, this would use an email service API like SendGrid

        const subject = encodeURIComponent(`Test ${testResult.status}: ${testResult.suiteName}`);
        const body = encodeURIComponent(`
Test Execution Report

Test Name: ${testResult.suiteName}
Status: ${testResult.status}
Duration: ${testResult.executionTime}ms
Timestamp: ${new Date(testResult.timestamp).toLocaleString()}

${testResult.errorMessage ? 'Error: ' + testResult.errorMessage : ''}

---
LVX-Machina Test Automation
    `.trim());

        const mailto = `mailto:${integration.email}?subject=${subject}&body=${body}`;

        // Open mailto link in new window
        window.open(mailto, '_blank');

        return { success: true, integration: 'email' };
    }

    // Test integration (send test message)
    async testIntegration(integrationId) {
        const integration = this.getIntegration(integrationId);
        if (!integration) throw new Error('Integration not found');

        const testResult = {
            suiteId: 'test-id',
            suiteName: 'Test Notification',
            status: 'PASSED',
            executionTime: 1234,
            timestamp: new Date().toISOString(),
            errorMessage: null
        };

        try {
            await this._sendToIntegration(integration, testResult);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Record notification attempt
    recordNotification(integration, testResult, success, error = null) {
        const history = this.getNotificationHistory();

        const record = {
            id: this._generateId(),
            timestamp: new Date().toISOString(),
            integrationId: integration.id,
            integrationName: integration.name,
            integrationType: integration.type,
            testName: testResult.suiteName,
            testStatus: testResult.status,
            success,
            error: error?.message || null
        };

        history.push(record);

        // Keep only MAX_HISTORY
        if (history.length > this.MAX_HISTORY) {
            history.splice(0, history.length - this.MAX_HISTORY);
        }

        localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    }

    getNotificationHistory(limit = 50) {
        const data = localStorage.getItem(this.HISTORY_KEY);
        const history = data ? JSON.parse(data) : [];
        return history.slice(-limit).reverse(); // Most recent first
    }

    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // ============================================
    // SECURITY SCAN NOTIFICATIONS
    // ============================================

    // Send security scan notification to all enabled integrations
    async sendSecurityNotification(scanResults) {
        const integrations = this.getEnabledIntegrations();

        if (integrations.length === 0) {
            console.log('No enabled integrations to notify');
            return { success: 0, failed: 0 };
        }

        const results = await Promise.allSettled(
            integrations.map(integration => this._sendSecurityToIntegration(integration, scanResults))
        );

        const success = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        console.log(`Security notifications sent: ${success} succeeded, ${failed} failed`);

        return { success, failed, results };
    }

    // Send security notification to specific integration
    async _sendSecurityToIntegration(integration, scanResults) {
        console.log(`Sending security notification via ${integration.type}...`);

        try {
            let result;
            switch (integration.type) {
                case 'slack':
                    result = await this._sendSlackSecurityNotification(integration, scanResults);
                    break;
                case 'discord':
                    result = await this._sendDiscordSecurityNotification(integration, scanResults);
                    break;
                case 'webhook':
                    result = await this._sendWebhookSecurityNotification(integration, scanResults);
                    break;
                default:
                    throw new Error(`Unknown integration type: ${integration.type}`);
            }
            return result;
        } catch (error) {
            console.error(`Security notification failed for ${integration.type}:`, error);
            throw error;
        }
    }

    // Slack security notification
    async _sendSlackSecurityNotification(integration, scanResults) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Slack webhook URL not configured');

        const { summary, policyPassed, vulnerabilities } = scanResults;
        const critical = summary?.critical || 0;
        const high = summary?.high || 0;
        const medium = summary?.medium || 0;
        const low = summary?.low || 0;
        const total = critical + high + medium + low;

        const color = critical > 0 ? '#dc2626' : high > 0 ? '#f97316' : medium > 0 ? '#eab308' : '#22c55e';
        const emoji = policyPassed ? '✅' : '❌';
        const status = policyPassed ? 'Passed' : 'Failed';

        const message = {
            username: 'LVX-Machina Security',
            icon_emoji: ':shield:',
            attachments: [{
                color: color,
                title: `${emoji} Security Scan: ${status}`,
                fields: [
                    { title: '🔴 Critical', value: String(critical), short: true },
                    { title: '🟠 High', value: String(high), short: true },
                    { title: '🟡 Medium', value: String(medium), short: true },
                    { title: '🟢 Low', value: String(low), short: true },
                    { title: 'Total Vulnerabilities', value: String(total), short: true },
                    { title: 'Policy Status', value: status, short: true }
                ],
                footer: 'LVX-Machina Security Testing',
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        // Add top vulnerabilities if any
        if (vulnerabilities && vulnerabilities.length > 0) {
            const topVulns = vulnerabilities.slice(0, 3).map(v =>
                `• [${v.severity}] ${v.ruleName || v.type}: ${v.description?.substring(0, 50) || 'No description'}...`
            ).join('\n');
            message.attachments[0].fields.push({
                title: 'Top Issues',
                value: topVulns,
                short: false
            });
        }

        const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            throw new Error(`Slack notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'slack' };
    }

    // Discord security notification
    async _sendDiscordSecurityNotification(integration, scanResults) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Discord webhook URL not configured');

        const { summary, policyPassed, vulnerabilities } = scanResults;
        const critical = summary?.critical || 0;
        const high = summary?.high || 0;
        const medium = summary?.medium || 0;
        const low = summary?.low || 0;
        const total = critical + high + medium + low;

        const color = critical > 0 ? 0xdc2626 : high > 0 ? 0xf97316 : medium > 0 ? 0xeab308 : 0x22c55e;
        const emoji = policyPassed ? '✅' : '❌';
        const status = policyPassed ? 'Passed' : 'Failed';

        const message = {
            username: 'LVX-Machina Security',
            embeds: [{
                title: `${emoji} Security Scan: ${status}`,
                color: color,
                fields: [
                    { name: '🔴 Critical', value: String(critical), inline: true },
                    { name: '🟠 High', value: String(high), inline: true },
                    { name: '🟡 Medium', value: String(medium), inline: true },
                    { name: '🟢 Low', value: String(low), inline: true },
                    { name: 'Total', value: String(total), inline: true },
                    { name: 'Policy', value: status, inline: true }
                ],
                footer: { text: 'LVX-Machina Security Testing' },
                timestamp: new Date().toISOString()
            }]
        };

        // Add top vulnerabilities if any
        if (vulnerabilities && vulnerabilities.length > 0) {
            const topVulns = vulnerabilities.slice(0, 3).map(v =>
                `• **[${v.severity}]** ${v.ruleName || v.type}`
            ).join('\n');
            message.embeds[0].fields.push({
                name: '🔥 Top Issues',
                value: topVulns,
                inline: false
            });
        }

        const response = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            throw new Error(`Discord notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'discord' };
    }

    // Webhook security notification
    async _sendWebhookSecurityNotification(integration, scanResults) {
        const webhook = integration.webhookUrl;
        if (!webhook) throw new Error('Webhook URL not configured');

        const payload = {
            event: 'security_scan_completed',
            timestamp: new Date().toISOString(),
            security: {
                policyPassed: scanResults.policyPassed,
                summary: scanResults.summary,
                vulnerabilities: scanResults.vulnerabilities?.slice(0, 10), // Limit to 10
                duration: scanResults.duration
            }
        };

        const response = await fetch(webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'LVX-Machina/1.0'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook notification failed: ${response.statusText}`);
        }

        return { success: true, integration: 'webhook' };
    }
}

// Export
window.IntegrationsManager = IntegrationsManager;
window.integrationsManager = new IntegrationsManager();

// ============================================
// UI MANAGEMENT FUNCTIONS
// ============================================

let editingIntegrationId = null;

// Open integrations modal
function openIntegrationsModal() {
    renderIntegrationsList();
    document.getElementById('integrations-modal').classList.remove('hidden');
}

function closeIntegrationsModal() {
    document.getElementById('integrations-modal').classList.add('hidden');
}

// Render integrations list
function renderIntegrationsList() {
    const container = document.getElementById('integrations-list');
    const integrations = window.integrationsManager.getAllIntegrations();

    if (integrations.length === 0) {
        container.innerHTML = '<p class="aero-text-muted text-sm">No integrations configured yet. Click an integration type on the left to add one.</p>';
        return;
    }

    container.innerHTML = integrations.map(integration => {
        const icons = {
            slack: '💬',
            discord: '💬',
            webhook: '🔗',
            email: '📧'
        };

        const icon = icons[integration.type] || '🔔';

        return `
      <div class='aero-button p-4 rounded-lg'>
        <div class='flex items-start justify-between mb-2'>
          <div class='flex items-center gap-3'>
            <span class='text-2xl'>${icon}</span>
            <div>
              <div class='font-semibold'>${integration.name}</div>
              <div class='text-xs aero-text-muted capitalize'>${integration.type}</div>
            </div>
          </div>
          <label class='flex items-center gap-2 cursor-pointer'>
            <input type='checkbox' 
              ${integration.enabled ? 'checked' : ''}
              onchange='toggleIntegrationStatus("${integration.id}")'
              class='w-4 h-4'>
            <span class='text-xs aero-text-muted'>${integration.enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        
        <div class='text-xs aero-text-muted mb-3'>
          ${getIntegrationDescription(integration)}
        </div>
        
        <div class='flex gap-2'>
          <button onclick='testIntegrationById("${integration.id}")' 
            class='aero-button-info text-xs py-1 px-3 rounded'>
            🧪 Test
          </button>
          <button onclick='editIntegration("${integration.id}")' 
            class='aero-button-warning text-xs py-1 px-3 rounded'>
            ✏️ Edit
          </button>
          <button onclick='deleteIntegrationWithConfirm("${integration.id}")' 
            class='aero-button-danger text-xs py-1 px-3 rounded'>
            🗑️ Delete
          </button>
        </div>
      </div>
    `;
    }).join('');
}

function getIntegrationDescription(integration) {
    const notifyWhen = [];
    if (integration.notifyOnFailure) notifyWhen.push('failures');
    if (integration.notifyOnSuccess) notifyWhen.push('successes');
    if (integration.notifyOnAll) notifyWhen.push('all tests');

    const whenText = notifyWhen.length > 0 ? 'Notifies on: ' + notifyWhen.join(', ') : 'Notifications disabled';

    switch (integration.type) {
        case 'slack':
        case 'discord':
        case 'webhook':
            return `Webhook configured | ${whenText}`;
        case 'email':
            return `Email: ${integration.email} | ${whenText}`;
        default:
            return whenText;
    }
}

// Toggle integration status
function toggleIntegrationStatus(integrationId) {
    const enabled = window.integrationsManager.toggleIntegration(integrationId);
    window.showMessage(
        enabled ? 'Integration enabled' : 'Integration disabled',
        'success'
    );
    renderIntegrationsList();
}

// Delete integration
function deleteIntegrationWithConfirm(integrationId) {
    const integration = window.integrationsManager.getIntegration(integrationId);
    if (!integration) return;

    if (confirm(`Delete integration "${integration.name}"?`)) {
        window.integrationsManager.deleteIntegration(integrationId);
        renderIntegrationsList();
        window.showMessage('Integration deleted', 'success');
    }
}

// Test integration
async function testIntegrationById(integrationId) {
    window.showMessage('Sending test notification...', 'info');

    try {
        const result = await window.integrationsManager.testIntegration(integrationId);
        if (result.success) {
            window.showMessage('Test notification sent successfully!', 'success');
        } else {
            window.showMessage('Test failed: ' + result.error, 'error');
        }
    } catch (error) {
        window.showMessage('Test failed: ' + error.message, 'error');
    }
}

// Open add integration modal
function openAddIntegrationModal(type) {
    editingIntegrationId = null;
    document.getElementById('integration-type').value = type;
    document.getElementById('integration-id').value = '';

    // Set title
    const titles = {
        slack: 'Add Slack Integration',
        discord: 'Add Discord Integration',
        webhook: 'Add Custom Webhook',
        email: 'Add Email Notification'
    };
    document.getElementById('add-integration-title').textContent = titles[type] || 'Add Integration';

    // Reset form
    document.getElementById('integration-name').value = '';
    document.getElementById('integration-webhook-url').value = '';
    document.getElementById('integration-email').value = '';
    document.getElementById('notify-on-failure').checked = true;
    document.getElementById('notify-on-success').checked = false;
    document.getElementById('notify-on-all').checked = false;

    // Show/hide fields based on type
    showIntegrationFields(type);

    // Show instructions
    showIntegrationInstructions(type);

    document.getElementById('add-integration-modal').classList.remove('hidden');
}

function closeAddIntegrationModal() {
    document.getElementById('add-integration-modal').classList.add('hidden');
}

// Edit integration
function editIntegration(integrationId) {
    const integration = window.integrationsManager.getIntegration(integrationId);
    if (!integration) return;

    editingIntegrationId = integrationId;

    document.getElementById('integration-id').value = integration.id;
    document.getElementById('integration-type').value = integration.type;
    document.getElementById('integration-name').value = integration.name;

    if (integration.webhookUrl) {
        document.getElementById('integration-webhook-url').value = integration.webhookUrl;
    }
    if (integration.email) {
        document.getElementById('integration-email').value = integration.email;
    }

    document.getElementById('notify-on-failure').checked = integration.notifyOnFailure !== false;
    document.getElementById('notify-on-success').checked = integration.notifyOnSuccess === true;
    document.getElementById('notify-on-all').checked = integration.notifyOnAll === true;

    const titles = {
        slack: 'Edit Slack Integration',
        discord: 'Edit Discord Integration',
        webhook: 'Edit Custom Webhook',
        email: 'Edit Email Notification'
    };
    document.getElementById('add-integration-title').textContent = titles[integration.type] || 'Edit Integration';

    showIntegrationFields(integration.type);
    showIntegrationInstructions(integration.type);

    document.getElementById('add-integration-modal').classList.remove('hidden');
}

// Show appropriate fields
function showIntegrationFields(type) {
    const webhookFields = document.getElementById('webhook-fields');
    const emailFields = document.getElementById('email-fields');

    webhookFields.classList.add('hidden');
    emailFields.classList.add('hidden');

    if (type === 'email') {
        emailFields.classList.remove('hidden');
    } else {
        webhookFields.classList.remove('hidden');

        // Update webhook URL placeholder and help text
        const webhookInput = document.getElementById('integration-webhook-url');
        const webhookHelp = document.getElementById('webhook-help');

        const placeholders = {
            slack: 'https://hooks.slack.com/services/...',
            discord: 'https://discord.com/api/webhooks/...',
            webhook: 'https://your-server.com/webhook'
        };

        webhookInput.placeholder = placeholders[type] || 'https://...';

        const helpTexts = {
            slack: 'Get webhook URL from Slack: Workspace Settings → Apps → Incoming Webhooks',
            discord: 'Get webhook URL from Discord: Server Settings → Integrations → Webhooks',
            webhook: 'Any endpoint that accepts POST requests with JSON payload'
        };

        webhookHelp.textContent = helpTexts[type] || '';
    }
}

// Show integration instructions
function showIntegrationInstructions(type) {
    const container = document.getElementById('integration-instructions');

    const instructions = {
        slack: `
      <div><strong>1.</strong> Go to your Slack workspace</div>
      <div><strong>2.</strong> Navigate to: Settings & Administration → Manage Apps</div>
      <div><strong>3.</strong> Search for "Incoming Webhooks" and add to workspace</div>
      <div><strong>4.</strong> Choose a channel and copy the webhook URL</div>
      <div><strong>5.</strong> Paste the webhook URL above</div>
    `,
        discord: `
      <div><strong>1.</strong> Open Discord server settings</div>
      <div><strong>2.</strong> Navigate to: Integrations → Webhooks</div>
      <div><strong>3.</strong> Click "New Webhook"</div>
      <div><strong>4.</strong> Choose a channel, customize name/avatar (optional)</div>
      <div><strong>5.</strong> Click "Copy Webhook URL" and paste above</div>
    `,
        webhook: `
      <div><strong>Webhook will receive POST requests with:</strong></div>
      <div>• Content-Type: application/json</div>
      <div>• User-Agent: LVX-Machina/1.0</div>
      <div>• Body: { event, timestamp, test: {...} }</div>
    `,
        email: `
      <div><strong>Note:</strong> Email notifications use mailto: links</div>
      <div>This will open your default email client</div>
      <div>For automated emails, consider using Webhook with email service API</div>
    `
    };

    container.innerHTML = instructions[type] || '';
}

// Save integration
function saveIntegration(event) {
    event.preventDefault();

    const type = document.getElementById('integration-type').value;
    const name = document.getElementById('integration-name').value.trim();

    if (!name) {
        window.showMessage('Please enter a name', 'warning');
        return;
    }

    const integration = {
        type,
        name,
        notifyOnFailure: document.getElementById('notify-on-failure').checked,
        notifyOnSuccess: document.getElementById('notify-on-success').checked,
        notifyOnAll: document.getElementById('notify-on-all').checked
    };

    if (type === 'email') {
        integration.email = document.getElementById('integration-email').value.trim();
        if (!integration.email) {
            window.showMessage('Please enter an email address', 'warning');
            return;
        }
    } else {
        integration.webhookUrl = document.getElementById('integration-webhook-url').value.trim();
        if (!integration.webhookUrl) {
            window.showMessage('Please enter a webhook URL', 'warning');
            return;
        }
    }

    const integrationId = document.getElementById('integration-id').value;
    if (integrationId) {
        integration.id = integrationId;
    }

    window.integrationsManager.saveIntegration(integration);
    window.showMessage(
        editingIntegrationId ? 'Integration updated' : 'Integration added',
        'success'
    );

    closeAddIntegrationModal();
    renderIntegrationsList();
}

// Test current integration being configured
async function testCurrentIntegration() {
    // Temporarily create integration for testing
    const type = document.getElementById('integration-type').value;
    const name = 'Test Integration';

    const integration = { type, name, enabled: true };

    if (type === 'email') {
        integration.email = document.getElementById('integration-email').value.trim();
        if (!integration.email) {
            window.showMessage('Please enter an email address first', 'warning');
            return;
        }
    } else {
        integration.webhookUrl = document.getElementById('integration-webhook-url').value.trim();
        if (!integration.webhookUrl) {
            window.showMessage('Please enter a webhook URL first', 'warning');
            return;
        }
    }

    const testResult = {
        suiteId: 'test-id',
        suiteName: 'Test Notification (Do Not Reply)',
        status: 'PASSED',
        executionTime: 1234,
        timestamp: new Date().toISOString()
    };

    window.showMessage('Sending test notification...', 'info');

    try {
        await window.integrationsManager._sendToIntegration(integration, testResult);
        window.showMessage('Test notification sent successfully!', 'success');
    } catch (error) {
        window.showMessage('Test failed: ' + error.message, 'error');
        console.error(error);
    }
}

// Switch tabs
function switchIntegrationsTab(tab) {
    const tabs = ['configured', 'history'];
    tabs.forEach(t => {
        document.getElementById(`integrations-tab-${t}`).className =
            t === tab
                ? 'py-2 px-4 font-semibold aero-text-primary border-b-2 border-blue-500'
                : 'py-2 px-4 font-semibold aero-text-muted';
        document.getElementById(`integrations-${t}-panel`).classList.toggle('hidden', t !== tab);
    });

    if (tab === 'history') {
        renderNotificationHistory();
    }
}

// Render notification history
function renderNotificationHistory() {
    const container = document.getElementById('notification-history-list');
    const history = window.integrationsManager.getNotificationHistory(50);

    if (history.length === 0) {
        container.innerHTML = '<p class="aero-text-muted text-sm">No notification history yet</p>';
        return;
    }

    container.innerHTML = history.map(record => `
    <div class='aero-button p-3 rounded flex justify-between items-center'>
      <div class='flex-1'>
        <div class='flex items-center gap-2 mb-1'>
          <span class='aero-badge-${record.success ? 'success' : 'error'} text-xs'>
            ${record.success ? '✓ Sent' : '✗ Failed'}
          </span>
          <span class='font-semibold text-sm'>${record.integrationName}</span>
          <span class='text-xs aero-text-muted'>(${record.integrationType})</span>
        </div>
        <div class='text-xs aero-text-muted'>
          Test: ${record.testName} (${record.testStatus}) | ${new Date(record.timestamp).toLocaleString()}
        </div>
        ${record.error ? `<div class='text-xs aero-text-danger mt-1'>${record.error}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// Export functions
window.openIntegrationsModal = openIntegrationsModal;
window.closeIntegrationsModal = closeIntegrationsModal;
window.toggleIntegrationStatus = toggleIntegrationStatus;
window.deleteIntegrationWithConfirm = deleteIntegrationWithConfirm;
window.testIntegrationById = testIntegrationById;
window.openAddIntegrationModal = openAddIntegrationModal;
window.closeAddIntegrationModal = closeAddIntegrationModal;
window.editIntegration = editIntegration;
window.saveIntegration = saveIntegration;
window.testCurrentIntegration = testCurrentIntegration;
window.switchIntegrationsTab = switchIntegrationsTab;
