class AdvancedAssertions {
    constructor() {
        this.screenshots = new Map(); // Store baseline screenshots
        this.STORAGE_KEY = 'baseline_screenshots';
        this.readyPromise = this.loadBaselines();
    }

    _getStorageManager() {
        return window.storageManager && window.storageManager.STORES ? window.storageManager : null;
    }

    _loadLegacyBaselines() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                this.screenshots = new Map(Object.entries(parsed));
            }
        } catch (error) {
            console.warn('Failed to load legacy screenshot baselines:', error);
            this.screenshots = new Map();
        }
    }

    // Load baseline screenshots from storage
    async loadBaselines() {
        this._loadLegacyBaselines();

        const storageManager = this._getStorageManager();
        if (!storageManager) {
            return this.screenshots;
        }

        try {
            const records = await storageManager.getAll(storageManager.STORES.screenshots);
            if (Array.isArray(records) && records.length > 0) {
                this.screenshots = new Map(records.map(record => [record.name || record.id, record.data || '']));
                if (typeof window.refreshBaselinesList === 'function') {
                    window.refreshBaselinesList();
                }
            }
        } catch (error) {
            console.warn('Failed to load screenshot baselines from IndexedDB:', error);
        }

        return this.screenshots;
    }

    // Save baselines to storage
    async saveBaselines() {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            const obj = Object.fromEntries(this.screenshots);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
            return;
        }

        try {
            const now = new Date().toISOString();
            const records = Array.from(this.screenshots.entries()).map(([name, data]) => ({
                id: name,
                name,
                data,
                format: 'base64',
                dateCreated: now,
                dateModified: now
            }));
            await storageManager.replaceAll(storageManager.STORES.screenshots, records);
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.error('Failed to persist screenshot baselines to IndexedDB:', error);
        }
    }

    async _persistScreenshot(name, data) {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            const obj = Object.fromEntries(this.screenshots);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
            return;
        }

        try {
            const now = new Date().toISOString();
            await storageManager.put(storageManager.STORES.screenshots, {
                id: name,
                name,
                data,
                format: 'base64',
                dateCreated: now,
                dateModified: now
            });
            localStorage.removeItem(this.STORAGE_KEY);
        } catch (error) {
            console.error('Failed to persist screenshot baseline:', error);
        }
    }

    async _deletePersistedScreenshot(name) {
        const storageManager = this._getStorageManager();
        if (!storageManager) {
            const obj = Object.fromEntries(this.screenshots);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
            return;
        }

        try {
            await storageManager.delete(storageManager.STORES.screenshots, name);
        } catch (error) {
            console.error('Failed to delete screenshot baseline from IndexedDB:', error);
        }
    }

    async ensureReady() {
        if (this.readyPromise) {
            await this.readyPromise;
        }
        return this.screenshots;
    }

    // Capture screenshot of iframe
    async captureScreenshot(iframeId, name) {
        const iframe = document.getElementById(iframeId);
        if (!iframe || !iframe.contentWindow) {
            throw new Error('Iframe not found or not loaded');
        }

        // Use html2canvas to capture iframe content
        const iframeDoc = iframe.contentWindow.document;
        const canvas = await html2canvas(iframeDoc.body, {
            allowTaint: true,
            useCORS: true,
            windowWidth: iframeDoc.body.scrollWidth,
            windowHeight: iframeDoc.body.scrollHeight
        });

        return canvas.toDataURL('image/png');
    }

    // Save baseline screenshot
    async saveBaseline(iframeId, name) {
        await this.ensureReady();
        const screenshot = await this.captureScreenshot(iframeId, name);
        this.screenshots.set(name, screenshot);
        await this._persistScreenshot(name, screenshot);
        return screenshot;
    }

    // Compare screenshot with baseline
    async compareWithBaseline(iframeId, name, threshold = 0.1) {
        await this.ensureReady();
        const baseline = this.screenshots.get(name);
        if (!baseline) {
            throw new Error(`No baseline found for "${name}". Please save a baseline first.`);
        }

        const current = await this.captureScreenshot(iframeId, name);

        // Use pixelmatch for comparison
        const diff = await this.compareImages(baseline, current, threshold);

        return {
            passed: diff.diffPercentage <= threshold * 100,
            diffPercentage: diff.diffPercentage,
            diffImageData: diff.diffImageData,
            baseline,
            current
        };
    }

    // Compare two images
    async compareImages(img1Data, img2Data, threshold) {
        // Create images
        const img1 = await this.loadImage(img1Data);
        const img2 = await this.loadImage(img2Data);

        // Ensure same dimensions
        const width = Math.max(img1.width, img2.width);
        const height = Math.max(img1.height, img2.height);

        // Create canvases
        const canvas1 = this.imageToCanvas(img1, width, height);
        const canvas2 = this.imageToCanvas(img2, width, height);
        const diffCanvas = document.createElement('canvas');
        diffCanvas.width = width;
        diffCanvas.height = height;

        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');
        const diffCtx = diffCanvas.getContext('2d');

        const imgData1 = ctx1.getImageData(0, 0, width, height);
        const imgData2 = ctx2.getImageData(0, 0, width, height);
        const diffData = diffCtx.createImageData(width, height);

        // Simple pixel comparison
        let diffPixels = 0;
        for (let i = 0; i < imgData1.data.length; i += 4) {
            const r1 = imgData1.data[i];
            const g1 = imgData1.data[i + 1];
            const b1 = imgData1.data[i + 2];

            const r2 = imgData2.data[i];
            const g2 = imgData2.data[i + 1];
            const b2 = imgData2.data[i + 2];

            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

            if (diff > 30) { // Threshold for pixel difference
                diffPixels++;
                // Highlight diff in red
                diffData.data[i] = 255;
                diffData.data[i + 1] = 0;
                diffData.data[i + 2] = 0;
                diffData.data[i + 3] = 255;
            } else {
                // Keep original
                diffData.data[i] = imgData2.data[i];
                diffData.data[i + 1] = imgData2.data[i + 1];
                diffData.data[i + 2] = imgData2.data[i + 2];
                diffData.data[i + 3] = imgData2.data[i + 3];
            }
        }

        diffCtx.putImageData(diffData, 0, 0);

        const totalPixels = width * height;
        const diffPercentage = (diffPixels / totalPixels) * 100;

        return {
            diffPercentage,
            diffImageData: diffCanvas.toDataURL('image/png')
        };
    }

    // Load image from data URL
    loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    // Convert image to canvas
    imageToCanvas(img, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas;
    }

    // Measure page performance
    async measurePerformance(iframeId) {
        const iframe = document.getElementById(iframeId);
        if (!iframe || !iframe.contentWindow) {
            throw new Error('Iframe not found');
        }

        const win = iframe.contentWindow;
        const performance = win.performance;

        if (!performance || !performance.timing) {
            throw new Error('Performance API not available');
        }

        const timing = performance.timing;
        const navigation = performance.navigation;

        return {
            // Page load times
            domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
            loadComplete: timing.loadEventEnd - timing.navigationStart,
            domInteractive: timing.domInteractive - timing.navigationStart,

            // Network times
            dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
            tcpConnection: timing.connectEnd - timing.connectStart,
            serverResponse: timing.responseEnd - timing.requestStart,

            // Rendering times
            domParsing: timing.domComplete - timing.domLoading,

            // Navigation type
            navigationType: navigation.type,

            // Resource count
            resourceCount: performance.getEntriesByType('resource').length
        };
    }

    // Check accessibility with basic rules
    async checkAccessibility(iframeId) {
        const iframe = document.getElementById(iframeId);
        if (!iframe || !iframe.contentWindow) {
            throw new Error('Iframe not found');
        }

        const doc = iframe.contentWindow.document;
        const issues = [];

        // Check for images without alt text
        const images = doc.querySelectorAll('img');
        images.forEach((img, index) => {
            if (!img.hasAttribute('alt')) {
                issues.push({
                    type: 'error',
                    rule: 'Images must have alt text',
                    element: `img[${index}]`,
                    wcag: 'WCAG 2.1 Level A'
                });
            }
        });

        // Check for form inputs without labels
        const inputs = doc.querySelectorAll('input, textarea, select');
        inputs.forEach((input, index) => {
            const id = input.id;
            if (id) {
                const label = doc.querySelector(`label[for="${id}"]`);
                if (!label) {
                    issues.push({
                        type: 'error',
                        rule: 'Form inputs must have associated labels',
                        element: `input#${id}`,
                        wcag: 'WCAG 2.1 Level A'
                    });
                }
            }
        });

        // Check heading hierarchy
        const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        let previousLevel = 0;
        headings.forEach((heading, index) => {
            const level = parseInt(heading.tagName[1]);
            if (level - previousLevel > 1) {
                issues.push({
                    type: 'warning',
                    rule: 'Heading levels should not skip',
                    element: heading.tagName,
                    wcag: 'WCAG 2.1 Best Practice'
                });
            }
            previousLevel = level;
        });

        // Check for links with same text going to different URLs
        const links = doc.querySelectorAll('a[href]');
        const linkTexts = new Map();
        links.forEach(link => {
            const text = link.textContent.trim();
            const href = link.href;
            if (text) {
                if (linkTexts.has(text) && linkTexts.get(text) !== href) {
                    issues.push({
                        type: 'warning',
                        rule: 'Links with same text should go to same destination',
                        element: `a[text="${text}"]`,
                        wcag: 'WCAG 2.1 Best Practice'
                    });
                }
                linkTexts.set(text, href);
            }
        });

        // Check color contrast (simplified - just checks if text has sufficient difference from background)
        const elements = doc.querySelectorAll('*');
        // This would need a proper color contrast algorithm
        // Simplified version omitted for brevity

        return {
            passed: issues.filter(i => i.type === 'error').length === 0,
            errorCount: issues.filter(i => i.type === 'error').length,
            warningCount: issues.filter(i => i.type === 'warning').length,
            issues
        };
    }

    // Delete baseline
    deleteBaseline(name) {
        this.screenshots.delete(name);
        this._deletePersistedScreenshot(name);
    }

    // Get all baselines
    getAllBaselines() {
        return Array.from(this.screenshots.keys());
    }
}

// Export
window.AdvancedAssertions = AdvancedAssertions;
window.advancedAssertions = new AdvancedAssertions();

// --- UI Logic ---

let currentComparisonData = null;

function showScreenshotComparison(result, name) {
    currentComparisonData = { result, name };

    document.getElementById('comparison-name').textContent = name;
    document.getElementById('comparison-diff').textContent = `${result.diffPercentage.toFixed(2)}%`;

    document.getElementById('comparison-baseline').src = result.baseline;
    document.getElementById('comparison-current').src = result.current;
    document.getElementById('comparison-diff-img').src = result.diffImageData;

    document.getElementById('screenshot-comparison-modal').classList.remove('hidden');
}

function closeScreenshotComparison() {
    document.getElementById('screenshot-comparison-modal').classList.add('hidden');
    currentComparisonData = null;
}

function updateBaseline() {
    if (!currentComparisonData) return;

    if (confirm(`Update baseline "${currentComparisonData.name}" with current screenshot?\n\nThis will replace the existing baseline.`)) {
        window.advancedAssertions.screenshots.set(
            currentComparisonData.name,
            currentComparisonData.result.current
        );
        window.advancedAssertions.saveBaselines();

        window.showMessage('Baseline updated', 'success');
        closeScreenshotComparison();
    }
}

function downloadComparisonImages() {
    if (!currentComparisonData) return;

    // Download baseline
    downloadImage(currentComparisonData.result.baseline, `${currentComparisonData.name}_baseline.png`);

    // Download current
    setTimeout(() => {
        downloadImage(currentComparisonData.result.current, `${currentComparisonData.name}_current.png`);
    }, 100);

    // Download diff
    setTimeout(() => {
        downloadImage(currentComparisonData.result.diffImageData, `${currentComparisonData.name}_diff.png`);
    }, 200);

    window.showMessage('Downloading comparison images...', 'info');
}

function downloadImage(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
}

// --- Baseline Management UI ---

function refreshBaselinesList() {
    const container = document.getElementById('baselines-list');
    if (!container) return;

    const baselines = window.advancedAssertions.getAllBaselines();

    if (baselines.length === 0) {
        container.innerHTML = '<p class="text-sm aero-text-muted">No baselines saved yet</p>';
        return;
    }

    container.innerHTML = baselines.map(name => `
    <div class='aero-button p-3 rounded flex justify-between items-center'>
      <div class='flex items-center gap-3'>
        <img src='${window.advancedAssertions.screenshots.get(name)}' 
          class='w-16 h-16 object-cover rounded border border-gray-300' />
        <span class='font-semibold'>${name}</span>
      </div>
      <div class='flex gap-2'>
        <button onclick='viewBaseline("${name}")' 
          class='aero-button-info text-sm py-1 px-3 rounded'>
          👁️ View
        </button>
        <button onclick='downloadBaseline("${name}")' 
          class='aero-button-gray text-sm py-1 px-3 rounded'>
          💾
        </button>
        <button onclick='deleteBaseline("${name}")' 
          class='aero-button-danger text-sm py-1 px-3 rounded'>
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}

function viewBaseline(name) {
    const imageData = window.advancedAssertions.screenshots.get(name);
    if (!imageData) return;

    // Open in new window
    const win = window.open('', '_blank', 'width=800,height=600');
    win.document.write(`
    <html>
      <head><title>Baseline: ${name}</title></head>
      <body style='margin: 0; display: flex; justify-content: center; align-items: center; background: #f0f0f0;'>
        <img src='${imageData}' style='max-width: 100%; max-height: 100%; object-fit: contain;' />
      </body>
    </html>
  `);
}

function downloadBaseline(name) {
    const imageData = window.advancedAssertions.screenshots.get(name);
    if (!imageData) return;

    downloadImage(imageData, `${name}_baseline.png`);
    window.showMessage('Downloaded baseline', 'success');
}

function deleteBaseline(name) {
    if (confirm(`Delete baseline "${name}"?\n\nTests using this baseline will fail until a new baseline is saved.`)) {
        window.advancedAssertions.deleteBaseline(name);
        refreshBaselinesList();
        window.showMessage('Baseline deleted', 'success');
    }
}

function exportAllBaselines() {
    const baselines = window.advancedAssertions.getAllBaselines();
    if (baselines.length === 0) {
        window.showMessage('No baselines to export', 'warning');
        return;
    }

    const exportData = {};
    baselines.forEach(name => {
        exportData[name] = window.advancedAssertions.screenshots.get(name);
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screenshot_baselines_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    window.showMessage('Baselines exported', 'success');
}

function clearAllBaselines() {
    const baselines = window.advancedAssertions.getAllBaselines();
    if (baselines.length === 0) {
        window.showMessage('No baselines to clear', 'info');
        return;
    }

    if (confirm(`Delete all ${baselines.length} baseline(s)?\n\nThis cannot be undone.`)) {
        baselines.forEach(name => window.advancedAssertions.deleteBaseline(name));
        refreshBaselinesList();
        window.showMessage('All baselines cleared', 'success');
    }
}

// Export functions
window.showScreenshotComparison = showScreenshotComparison;
window.closeScreenshotComparison = closeScreenshotComparison;
window.updateBaseline = updateBaseline;
window.downloadComparisonImages = downloadComparisonImages;
window.refreshBaselinesList = refreshBaselinesList;
window.viewBaseline = viewBaseline;
window.downloadBaseline = downloadBaseline;
window.deleteBaseline = deleteBaseline;
window.exportAllBaselines = exportAllBaselines;
window.clearAllBaselines = clearAllBaselines;
