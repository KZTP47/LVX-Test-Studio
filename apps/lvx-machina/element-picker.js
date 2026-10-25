/**
 * ELEMENT PICKER
 * Handles visual selection of DOM elements within the Visual Web Tester iframe.
 * Generates smart CSS selectors and provides a UI for selection.
 */

class ElementPicker {
    constructor(iframeId) {
      this.iframeId = iframeId;
      this.isActive = false;
      this.overlay = null;
      this.highlightBox = null;
      this.onSelectCallback = null;
      this.iframeDoc = null;
      this.iframeWin = null;
  
      // Bind methods
      this.mouseMoveHandler = (e) => this._onMouseMove(e);
      this.clickHandler = (e) => this._onClick(e);
      this.keyHandler = (e) => this._onKeyPress(e);
    }
    
    // Activate picker mode
    activate(onSelect) {
      if (this.isActive) return;
      
      this.onSelectCallback = onSelect;
      this.isActive = true;
      
      const iframe = document.getElementById(this.iframeId);
      if (!iframe || !iframe.contentWindow) {
        console.error('Iframe not found or not loaded');
        if(window.showMessage) window.showMessage('Error: Iframe not loaded', 'error');
        return;
      }
      
      this.iframeDoc = iframe.contentWindow.document;
      this.iframeWin = iframe.contentWindow;
      
      this._createOverlay();
      this._attachListeners();
      this._setCursor();
      
      // Show instruction tooltip
      this._showInstructions();
    }
    
    // Deactivate picker mode
    deactivate() {
      if (!this.isActive) return;
      
      this.isActive = false;
      this._removeOverlay();
      this._detachListeners();
      this._resetCursor();
      this._hideInstructions();
    }
    
    // Create semi-transparent overlay and highlight box
    _createOverlay() {
      // Container for picker UI inside iframe
      this.overlay = this.iframeDoc.createElement('div');
      this.overlay.id = 'element-picker-container';
      this.overlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100% !important;
        height: 100% !important;
        z-index: 2147483640 !important;
        pointer-events: none !important;
      `;
      
      // The highlighting box
      this.highlightBox = this.iframeDoc.createElement('div');
      this.highlightBox.id = 'element-picker-highlight';
      this.highlightBox.style.cssText = `
        position: absolute !important;
        border: 2px solid #4CC2FF !important;
        background: rgba(76, 194, 255, 0.2) !important;
        pointer-events: none !important;
        z-index: 2147483641 !important;
        display: none;
        transition: all 0.05s ease !important;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.5) inset !important;
      `;
      
      this.overlay.appendChild(this.highlightBox);
      this.iframeDoc.body.appendChild(this.overlay);
    }
    
    // Remove overlay
    _removeOverlay() {
      if (this.overlay) this.overlay.remove();
    }
    
    // Attach event listeners
    _attachListeners() {
      this.iframeDoc.addEventListener('mousemove', this.mouseMoveHandler, true);
      this.iframeDoc.addEventListener('click', this.clickHandler, true);
      this.iframeDoc.addEventListener('keydown', this.keyHandler, true);
    }
    
    // Detach event listeners
    _detachListeners() {
      if (this.iframeDoc) {
        this.iframeDoc.removeEventListener('mousemove', this.mouseMoveHandler, true);
        this.iframeDoc.removeEventListener('click', this.clickHandler, true);
        this.iframeDoc.removeEventListener('keydown', this.keyHandler, true);
      }
    }
    
    // Handle mouse move - highlight element
    _onMouseMove(e) {
      e.stopPropagation();
      const element = this.iframeDoc.elementFromPoint(e.clientX, e.clientY);
      
      if (!element || element === this.iframeDoc.body || element === this.iframeDoc.documentElement || element === this.overlay) {
        this.highlightBox.style.display = 'none';
        return;
      }
      
      const rect = element.getBoundingClientRect();
      // Account for scrolling
      const scrollX = this.iframeWin.pageXOffset || this.iframeDoc.documentElement.scrollLeft;
      const scrollY = this.iframeWin.pageYOffset || this.iframeDoc.documentElement.scrollTop;

      this.highlightBox.style.display = 'block';
      this.highlightBox.style.top = (rect.top + scrollY) + 'px';
      this.highlightBox.style.left = (rect.left + scrollX) + 'px';
      this.highlightBox.style.width = rect.width + 'px';
      this.highlightBox.style.height = rect.height + 'px';
      
      // Optional: Add a label with the tag name
      this.highlightBox.setAttribute('data-label', element.tagName.toLowerCase());
    }
    
    // Handle click - select element
    _onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const element = this.iframeDoc.elementFromPoint(e.clientX, e.clientY);
      
      if (!element || element === this.iframeDoc.body || element === this.iframeDoc.documentElement || element === this.overlay) {
        return;
      }
      
      // Get all possible selectors
      const allSelectors = this.getAllPossibleSelectors(element);
      
      // Pause highlighting
      this._detachListeners();
      this.highlightBox.style.borderColor = '#4CAF50'; // Turn green
      this.highlightBox.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';

      // Show choice modal
      this._showSelectorChoiceModal(element, allSelectors, (chosenSelector) => {
        this.deactivate(); // Fully close
        if (this.onSelectCallback) {
          this.onSelectCallback(chosenSelector, element);
        }
      }, () => {
        // Cancelled choice
        this._attachListeners(); // Resume highlighting
        this.highlightBox.style.borderColor = '#4CC2FF';
        this.highlightBox.style.backgroundColor = 'rgba(76, 194, 255, 0.2)';
      });
    }
    
    // Handle ESC key - cancel picker
    _onKeyPress(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.deactivate();
      }
    }
    
    // Generate smart selectors
    getAllPossibleSelectors(element) {
      const selectors = [];
      
      // 1. ID (Best)
      if (element.id) {
        selectors.push({ 
          selector: '#' + element.id, 
          specificity: 'High (Unique ID)',
          description: 'Best match. Selects by unique ID.'
        });
      }
      
      // 2. Name attribute (Good for inputs)
      if (element.name) {
        selectors.push({
          selector: `${element.tagName.toLowerCase()}[name="${element.name}"]`,
          specificity: 'High (Name Attribute)',
          description: 'Good for form inputs.'
        });
      }
      
      // 3. Unique Class combinations
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/).filter(c => c);
        if (classes.length > 0) {
            const classSelector = '.' + classes.join('.');
            selectors.push({
                selector: classSelector,
                specificity: 'Medium (Classes)',
                description: 'Selects by all combined classes.'
            });
            
            // Individual classes if they look meaningful
            classes.forEach(cls => {
                // Filter out utility classes often found in Tailwind/Bootstrap if generic
                if(cls.length > 2 && !cls.match(/^(flex|grid|text-|bg-|p-|m-)/)) { 
                     selectors.push({
                        selector: '.' + cls,
                        specificity: 'Low (Single Class)',
                        description: `Selects by class '${cls}'.`
                    });
                }
            });
        }
      }
      
      // 4. Type (for inputs)
      if (element.type) {
        selectors.push({
          selector: `${element.tagName.toLowerCase()}[type="${element.type}"]`,
          specificity: 'Low (Type)',
          description: `Selects all inputs of type '${element.type}'.`
        });
      }

      // 5. Placeholder
      if (element.placeholder) {
          selectors.push({
              selector: `${element.tagName.toLowerCase()}[placeholder="${element.placeholder}"]`,
              specificity: 'Medium (Placeholder)',
              description: 'Selects by placeholder text.'
          });
      }
      
      // 6. Data attributes (Often used for testing)
      Array.from(element.attributes).forEach(attr => {
          if (attr.name.startsWith('data-') || attr.name === 'role' || attr.name === 'aria-label') {
            selectors.push({
              selector: `[${attr.name}="${attr.value}"]`,
              specificity: 'Medium (Attribute)',
              description: `Selects by ${attr.name}.`
            });
          }
      });
      
      // 7. Text content (if short and unique-ish)
      const text = element.textContent.trim();
      if (text.length > 0 && text.length < 30 && !element.children.length) {
           // Note: This is a pseudo-selector logic for Robot Framework "text=" or xpath
           // For CSS selector we can't easily do text equals, but we can suggest XPath if we supported it.
           // Keeping to CSS selectors for now.
      }
      
      // 8. Path / Structural Fallback
      const pathSelector = this._generatePathSelector(element);
      selectors.push({
        selector: pathSelector,
        specificity: 'Exact (Structural Path)',
        description: 'Fallback. Dependent on page structure.'
      });
      
      // Deduplicate
      const uniqueSelectors = [];
      const seen = new Set();
      selectors.forEach(s => {
          if(!seen.has(s.selector)) {
              seen.add(s.selector);
              uniqueSelectors.push(s);
          }
      });
      
      return uniqueSelectors;
    }
    
    // Generate path-based selector
    _generatePathSelector(element) {
      if (element === this.iframeDoc.body) return 'body';
      
      const path = [];
      let current = element;
      
      while (current && current !== this.iframeDoc.body && current.parentElement) {
        let selector = current.tagName.toLowerCase();
        
        // Add nth-of-type if needed for uniqueness among siblings
        const parent = current.parentElement;
        const siblings = Array.from(parent.children).filter(e => e.tagName === current.tagName);
        
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        } else if (current.id) {
             // Short circuit if we hit an ID on the way up
             selector = '#' + current.id;
             path.unshift(selector);
             break;
        }
        
        path.unshift(selector);
        current = current.parentElement;
      }
      
      return path.join(' > ');
    }
    
    _setCursor() {
      this.iframeDoc.body.style.cursor = 'crosshair';
    }
    
    _resetCursor() {
      if (this.iframeDoc && this.iframeDoc.body) {
          this.iframeDoc.body.style.cursor = '';
      }
    }
    
    _showInstructions() {
      const tooltip = this.iframeDoc.createElement('div');
      tooltip.id = 'picker-instructions';
      tooltip.style.cssText = `
        position: fixed !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        background: rgba(21, 101, 192, 0.9) !important;
        color: white !important;
        padding: 8px 16px !important;
        border-radius: 20px !important;
        z-index: 2147483647 !important;
        font-family: sans-serif !important;
        font-size: 14px !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        pointer-events: none !important;
        border: 1px solid rgba(255,255,255,0.3) !important;
        backdrop-filter: blur(4px) !important;
      `;
      tooltip.innerHTML = '🎯 Click element to select &bull; ESC to cancel';
      this.iframeDoc.body.appendChild(tooltip);
    }
    
    _hideInstructions() {
      if(this.iframeDoc) {
          const tooltip = this.iframeDoc.getElementById('picker-instructions');
          if (tooltip) tooltip.remove();
      }
    }

    _showSelectorChoiceModal(element, selectors, onChoose, onCancel) {
        // Create modal in parent window (main app)
        const modal = document.createElement('div');
        modal.id = 'selector-choice-modal';
        modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-40 backdrop-blur-sm';
        
        const elementLabel = `<${element.tagName.toLowerCase()}>`;
        
        modal.innerHTML = `
          <div class='aero-modal p-6 max-w-2xl w-full max-h-[80vh] flex flex-col shadow-2xl transform transition-all scale-100'>
            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                <div>
                    <h4 class='text-xl font-bold aero-text-primary'>Select Selector</h4>
                    <p class='text-sm text-gray-500'>For element: <code class="bg-gray-100 px-1 rounded text-blue-600">${elementLabel}</code></p>
                </div>
                <button id="selector-modal-close" class="text-gray-400 hover:text-gray-600 text-2xl font-bold px-2">&times;</button>
            </div>
            
            <div class='space-y-2 overflow-y-auto pr-2 flex-1' style="min-height: 200px;">
              ${selectors.map((s, i) => `
                <div class='selector-option p-3 rounded border border-transparent hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-all group' onclick='window._chooseSelectorOption(${i})'>
                  <div class='flex justify-between items-start mb-1'>
                    <code class='text-sm font-mono text-blue-700 font-bold break-all'>${s.selector}</code>
                    <span class='text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 whitespace-nowrap ml-2'>${s.specificity}</span>
                  </div>
                  <div class='text-xs text-gray-500 group-hover:text-gray-700'>${s.description}</div>
                </div>
              `).join('')}
            </div>
            
            <div class="mt-4 pt-3 border-t aero-divider flex justify-end gap-2 flex-shrink-0">
                <button id="selector-modal-cancel" class='aero-button-gray px-4 py-2 rounded font-semibold hover:bg-gray-200 transition'>
                  Cancel
                </button>
            </div>
          </div>
        `;
        
        document.body.appendChild(modal);
        
        // Store callbacks
        window._activeSelectorModal = modal;
        window._activeSelectorOptions = selectors;
        
        // Global handler for option click
        window._chooseSelectorOption = (index) => {
            const chosen = selectors[index].selector;
            document.body.removeChild(modal);
            delete window._activeSelectorModal;
            onChoose(chosen);
        };

        const closeHandler = (e) => {
            if(e) e.stopPropagation();
            if(document.body.contains(modal)) document.body.removeChild(modal);
            delete window._activeSelectorModal;
            onCancel();
        };

        // Bind Cancel Buttons
        const closeBtn = modal.querySelector('#selector-modal-close');
        if(closeBtn) closeBtn.onclick = closeHandler;
        
        const cancelBtn = modal.querySelector('#selector-modal-cancel');
        if(cancelBtn) cancelBtn.onclick = closeHandler;
        
        // Close on outside click
        modal.onclick = (e) => {
            if (e.target === modal) closeHandler(e);
        };
      }
  }
  
  // Export
  window.ElementPicker = ElementPicker;