class AdvancedAssertions {
    constructor() {
        this.screenshots = new Map(); // Store baseline screenshots
        this.STORAGE_KEY = 'baseline_screenshots';
        this.loadBaselines();
    }

    // Load baseline screenshots from storage
    loadBaselines() {
        const data = localStorage.getItem(this.STORAGE_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            this.screenshots = new Map(Object.entries(parsed));
        }
    }

    // Save baselines to storage
    saveBaselines() {
        const obj = Object.fromEntries(this.screenshots);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(obj));
    }

    resolveWindow(target) {
        const value = typeof target === 'string' ? document.getElementById(target) : target;
        const win = value?.contentWindow || (value?.document ? value : null);
        if (!win?.document) throw new Error('Iframe not found or not loaded');
        return win;
    }

    // Capture screenshot of iframe
    async captureScreenshot(iframeId, name) {
        const iframeDoc = this.resolveWindow(iframeId).document;
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
        const screenshot = await this.captureScreenshot(iframeId, name);
        this.screenshots.set(name, screenshot);
        this.saveBaselines();
        return screenshot;
    }

    // Compare screenshot with baseline
    async compareWithBaseline(iframeId, name, threshold = 0.1) {
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

            const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) + Math.abs(imgData1.data[i + 3] - imgData2.data[i + 3]);

            if (diff > (threshold === 0 ? 0 : 30)) { // Exact mode preserves every changed channel
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
        const win = this.resolveWindow(iframeId);
        const performance = win.performance;

        if (!performance) throw new Error('Performance API not available');
        const entry = performance.getEntriesByType?.('navigation')?.[0];
        const timing = entry || performance.timing;
        if (!timing) throw new Error('Navigation performance timing unavailable');
        const start = entry ? 0 : timing.navigationStart;
        const metrics = {
            domContentLoaded: timing.domContentLoadedEventEnd - start,
            loadComplete: timing.loadEventEnd - start,
            domInteractive: timing.domInteractive - start,
            dnsLookup: timing.domainLookupEnd - timing.domainLookupStart,
            tcpConnection: timing.connectEnd - timing.connectStart,
            serverResponse: timing.responseEnd - timing.requestStart,
            domParsing: timing.domComplete - (entry ? timing.domInteractive : timing.domLoading),
            navigationType: entry?.type ?? performance.navigation?.type ?? 0,
            resourceCount: performance.getEntriesByType?.('resource')?.length || 0
        };
        if (!Number.isFinite(metrics.loadComplete) || metrics.loadComplete < 0 || timing.loadEventEnd === 0) {
            throw new Error('Page load timing is incomplete; wait for page load before checking performance');
        }
        return metrics;
    }

    // Check accessibility with basic rules
    async checkAccessibility(iframeId) {
        const doc = this.resolveWindow(iframeId).document;
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
            const type = (input.getAttribute('type') || '').toLowerCase();
            const style = doc.defaultView?.getComputedStyle?.(input);
            if (type === 'hidden' || input.hidden || input.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') return;
            const aria = (input.getAttribute('aria-label') || '').trim();
            const labelledBy = (input.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
            const referencedName = labelledBy.map(id => doc.getElementById(id)?.textContent || '').join(' ').trim();
            const labels = Array.from(input.labels || []);
            const wrappingLabel = input.closest?.('label');
            const labelName = labels.some(label => label.textContent.trim()) || Boolean(wrappingLabel?.textContent.trim());
            const buttonName = ['button', 'submit', 'reset'].includes(type) && Boolean(input.value?.trim());
            const imageName = type === 'image' && Boolean(input.getAttribute('alt')?.trim());
            if (!aria && !referencedName && !labelName && !buttonName && !imageName && !input.getAttribute('title')?.trim()) {
                issues.push({ type: 'error', rule: 'Form inputs must have an accessible name',
                    element: `${input.tagName.toLowerCase()}[${index}]`, wcag: 'WCAG 2.1 Level A' });
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
        this.saveBaselines();
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
          ${window.LVXIcons?.svg("eye") || ''} View
        </button>
        <button onclick='downloadBaseline("${name}")'
          class='aero-button-gray text-sm py-1 px-3 rounded'>
          ${window.LVXIcons?.svg("save") || ''}
        </button>
        <button onclick='deleteBaseline("${name}")'
          class='aero-button-danger text-sm py-1 px-3 rounded'>
          ${window.LVXIcons?.svg("trash") || ''}
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
