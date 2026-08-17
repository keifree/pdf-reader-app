/**
 * Antigravity PDF Studio - Core PDF.js Rendering Engine
 * Guaranteed 100% Fit-to-Screen (Portrait & Landscape, 1-Page & 2-Page Spread)
 * Real-time Accurate Zoom Percentage Sync & Smooth GPU Touch Pinch
 */

export class PDFViewer {
  constructor(containerElement, spreadViewElement) {
    this.container = containerElement;
    this.spreadView = spreadViewElement;

    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;

    // View state
    this.viewMode = 'spread';     // 'spread' or 'single'
    this.bindingMode = 'rtl';      // 'rtl' (右綴じ) or 'ltr' (左綴じ)
    this.hasCoverPage = true;     // true: P1 single cover, false: P1+P2 spread
    this.scaleMode = 'fit-height'; // 'fit-height', 'fit-width', '100', or 'custom'
    this.customScale = 1.0;
    this.lastComputedScale = 1.0;

    // Smooth Pinch & GPU Panning State
    this.currentCssScale = 1.0;
    this.translateX = 0;
    this.translateY = 0;

    // Theme & Filter States
    this.themeMode = 'normal';     // 'normal', 'dark', 'sepia'
    this.brightness = 100;         // 50% ~ 150%
    this.contrast = 100;           // 50% ~ 150%

    // Event Handlers
    this.onPageChange = null;
    this.onZoomChange = null;

    this.initMouseWheelEvents();
    this.initTouchEvents();
  }

  async loadDocument(dataBuffer, initialPage = 1) {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library is not loaded');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const loadingTask = window.pdfjsLib.getDocument({
      data: dataBuffer,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
    });
    this.pdfDoc = await loadingTask.promise;

    this.ocgConfig = null;
    try {
      const ocgConfig = await this.pdfDoc.getOptionalContentConfig();
      if (ocgConfig && ocgConfig.getOrder) {
        let hasAntigravityLayer = false;
        const checkGroups = (groups) => {
          for (const item of groups) {
             if (Array.isArray(item)) { checkGroups(item); }
             else if (typeof item === 'string') {
                const group = ocgConfig.getGroup(item);
                if (group && group.name === 'AntigravityLayer') {
                   ocgConfig.setVisibility(item, false);
                   hasAntigravityLayer = true;
                }
             }
          }
        };
        const order = ocgConfig.getOrder();
        if (order) checkGroups(order);
        
        if (hasAntigravityLayer) {
           this.ocgConfig = ocgConfig;
        }
      }
    } catch (e) {
      console.warn('OCG processing notice:', e);
    }

    this.totalPages = this.pdfDoc.numPages;
    this.currentPage = Math.min(Math.max(1, initialPage), this.totalPages);

    await this.render();
  }

  async render() {
    if (!this.pdfDoc) return;

    // Reset CSS scale transform
    this.currentCssScale = 1.0;
    this.spreadView.style.transform = 'scale(1)';

    this.spreadView.innerHTML = '';
    const pagesToRender = this.calculatePagesForCurrentView();

    for (const pageNum of pagesToRender) {
      const card = await this.renderSinglePageCard(pageNum, pagesToRender.length);
      this.spreadView.appendChild(card);
    }

    this.applyThemeFilters();
    this.updateSpreadViewCentering();

    if (this.currentSearchQuery) {
      setTimeout(() => {
        this.highlightSearchMatches(this.currentSearchQuery, this.currentSearchNormQuery);
      }, 50);
    }

    if (this.onPageChange) {
      this.onPageChange(this.currentPage, this.totalPages);
    }

    if (this.onZoomChange) {
      this.onZoomChange(this.scaleMode, Math.round(this.lastComputedScale * 100));
    }
  }

  updateSpreadViewCentering() {
    setTimeout(() => {
      if (!this.spreadView || !this.container) return;
      const isOverflowingW = this.spreadView.scrollWidth > (this.container.clientWidth + 5);
      const isOverflowingH = this.spreadView.scrollHeight > (this.container.clientHeight + 5);

      if (isOverflowingW) {
        this.container.style.justifyContent = 'flex-start';
        this.spreadView.style.margin = '0';
      } else {
        this.container.style.justifyContent = 'center';
        this.spreadView.style.margin = 'auto';
      }

      if (isOverflowingH) {
        this.container.style.alignItems = 'flex-start';
      } else {
        this.container.style.alignItems = 'center';
      }
    }, 60);
  }

  calculatePagesForCurrentView() {
    if (this.viewMode === 'single') {
      return [this.currentPage];
    }

    if (this.hasCoverPage && this.currentPage === 1) {
      return [1];
    }

    let p1, p2;
    if (this.hasCoverPage) {
      const pairIndex = Math.floor((this.currentPage - 2) / 2);
      p1 = 2 + pairIndex * 2;
      p2 = p1 + 1;
    } else {
      const pairIndex = Math.floor((this.currentPage - 1) / 2);
      p1 = 1 + pairIndex * 2;
      p2 = p1 + 1;
    }

    let result = [];
    if (p1 <= this.totalPages) result.push(p1);
    if (p2 <= this.totalPages) result.push(p2);

    if (this.bindingMode === 'rtl' && result.length === 2) {
      result.reverse();
    }

    return result;
  }

  async renderSinglePageCard(pageNum, visiblePagesCount = 1) {
    const page = await this.pdfDoc.getPage(pageNum);

    const baseViewport = page.getViewport({ scale: 1.0 });
    const computedScale = this.calculateScale(baseViewport, visiblePagesCount);
    this.lastComputedScale = computedScale;

    const viewport = page.getViewport({ scale: computedScale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // HiDPI Retina crisp text rendering (max 2x for memory efficiency)

    const cardDiv = document.createElement('div');
    cardDiv.className = 'pdf-page-card';
    cardDiv.dataset.pageNum = pageNum;
    cardDiv.style.width = `${Math.floor(viewport.width)}px`;
    cardDiv.style.height = `${Math.floor(viewport.height)}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const ctx = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    };

    if (this.ocgConfig) {
      renderContext.optionalContentConfigPromise = Promise.resolve(this.ocgConfig);
    }

    await page.render(renderContext).promise;
    cardDiv.appendChild(canvas);

    // Render TextLayer for transparent OCR text & native text selection/search
    try {
      const textContent = await page.getTextContent();
      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
      textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
      textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

      let rendered = false;
      if (window.pdfjsLib.renderTextLayer) {
        try {
          const task = window.pdfjsLib.renderTextLayer({
            textContent: textContent,
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
          });
          if (task && task.promise) await task.promise;
          rendered = textLayerDiv.children.length > 0;
        } catch (e) {}
      }

      // Robust fallback manual span rendering for 100% OCR text layer guarantee
      if (!rendered || textLayerDiv.children.length === 0) {
        textLayerDiv.innerHTML = '';
        textContent.items.forEach(item => {
          if (!item.str || item.str.trim() === '') return;
          const span = document.createElement('span');
          span.textContent = item.str;
          
          if (item.transform && item.transform.length >= 6) {
            const tx = item.transform;
            const fontHeight = Math.hypot(tx[2], tx[3]) || 12;
            const scaleRatio = viewport.scale / baseViewport.scale;
            const left = tx[4] * scaleRatio;
            const top = (baseViewport.height - tx[5]) * scaleRatio - (fontHeight * scaleRatio);
            span.style.left = `${left}px`;
            span.style.top = `${top}px`;
            span.style.fontSize = `${fontHeight * scaleRatio}px`;
          }
          textLayerDiv.appendChild(span);
        });
      }

      cardDiv.appendChild(textLayerDiv);
    } catch (textErr) {
      console.warn('TextLayer render notice:', textErr);
    }

    const annotCanvas = document.createElement('canvas');
    annotCanvas.className = 'annotation-layer-canvas';
    annotCanvas.width = Math.floor(viewport.width * dpr);
    annotCanvas.height = Math.floor(viewport.height * dpr);
    annotCanvas.style.width = `${Math.floor(viewport.width)}px`;
    annotCanvas.style.height = `${Math.floor(viewport.height)}px`;
    cardDiv.appendChild(annotCanvas);

    return cardDiv;
  }

  async searchDocument(query) {
    if (!this.pdfDoc || !query || query.trim() === '') {
      this.searchResults = [];
      this.currentSearchIndex = -1;
      this.clearSearchHighlights();
      return { totalMatches: 0, currentIndex: -1, totalTextLength: 0 };
    }

    const rawQuery = query.trim();
    const normalizeText = (str) => {
      if (!str) return '';
      return str
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\r\n\t\f\v]/g, '')
        .replace(/\s+/g, '');
    };

    const normQuery = normalizeText(rawQuery);
    const results = [];
    let totalTextLength = 0;

    for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
      const page = await this.pdfDoc.getPage(pageNum);
      let textItems = [];

      try {
        const textContent = await page.getTextContent({ includeMarkedContent: true, disableCombineTextItems: false });
        if (textContent && textContent.items) {
          textItems = textContent.items.map(item => item.str || '');
        }
      } catch (e) {
        console.warn(`Page ${pageNum} textContent notice:`, e);
      }

      try {
        const annots = await page.getAnnotations();
        (annots || []).forEach(a => {
          if (a.contents) textItems.push(a.contents);
          if (a.fieldValue) textItems.push(String(a.fieldValue));
        });
      } catch (e) {}

      const rawText = textItems.join('');
      const spacedText = textItems.join(' ');
      totalTextLength += rawText.length;

      const normRaw = normalizeText(rawText);
      const normSpaced = normalizeText(spacedText);

      let found = false;

      // 1. Direct raw string inclusion
      if (rawText.includes(rawQuery) || spacedText.includes(rawQuery)) {
        found = true;
      }
      // 2. NFKC Normalized string inclusion
      else if (normQuery && (normRaw.includes(normQuery) || normSpaced.includes(normQuery))) {
        found = true;
      }
      // 3. Item-by-item substring matching
      else {
        for (const str of textItems) {
          if (str.includes(rawQuery) || (normQuery && normalizeText(str).includes(normQuery))) {
            found = true;
            break;
          }
        }
      }

      if (found) {
        results.push({
          pageNum,
          query: rawQuery,
          normQuery
        });
      }
    }

    this.searchResults = results;
    
    // Select match index nearest to current reading page (e.g. Page 200)
    let nearestIndex = 0;
    if (results.length > 0) {
      let minDistance = Infinity;
      results.forEach((m, idx) => {
        const dist = Math.abs(m.pageNum - this.currentPage);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIndex = idx;
        }
      });
    }
    this.currentSearchIndex = results.length > 0 ? nearestIndex : -1;

    // Apply highlights to currently visible page without forcing page jump while typing
    this.highlightSearchMatches(rawQuery, normQuery);

    return {
      totalMatches: results.length,
      currentIndex: this.currentSearchIndex,
      totalTextLength
    };
  }

  async jumpToSearchMatch(index) {
    if (!this.searchResults || this.searchResults.length === 0) return;
    this.currentSearchIndex = (index + this.searchResults.length) % this.searchResults.length;
    const match = this.searchResults[this.currentSearchIndex];
    
    this.currentPage = match.pageNum;
    await this.render();
    this.highlightSearchMatches(match.query, match.normQuery);
  }

  highlightSearchMatches(query, normQuery) {
    if (!query && !normQuery) return;
    this.currentSearchQuery = query;
    this.currentSearchNormQuery = normQuery;

    const normalizeText = (str) => {
      if (!str) return '';
      return str.normalize('NFKC').toLowerCase().replace(/[\r\n\t\f\v]/g, '').replace(/\s+/g, '');
    };

    const normQ = normQuery || normalizeText(query);
    const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

    const applyHighlighting = () => {
      const textLayers = document.querySelectorAll('.textLayer');
      textLayers.forEach(layer => {
        const spans = layer.querySelectorAll('span');
        spans.forEach(span => {
          if (!span.dataset.rawText) {
            span.dataset.rawText = span.textContent || '';
          }
          const origText = span.dataset.rawText;
          if (!origText || origText.trim() === '') return;

          const normSpan = normalizeText(origText);

          if (query && origText.toLowerCase().includes(query.toLowerCase())) {
            const reg = new RegExp(`(${escapeRegex(query)})`, 'gi');
            span.innerHTML = origText.replace(reg, '<mark class="search-word-match">$1</mark>');
          } else if (normQ && normSpan && (normSpan.includes(normQ) || normQ.includes(normSpan))) {
            span.innerHTML = `<mark class="search-word-match">${origText}</mark>`;
          } else {
            span.textContent = origText;
          }
        });
      });
    };

    applyHighlighting();
    setTimeout(applyHighlighting, 80);
    setTimeout(applyHighlighting, 280);
  }

  clearSearchHighlights() {
    this.currentSearchQuery = null;
    this.currentSearchNormQuery = null;
    this.savedSearchOriginPage = null;
    document.querySelectorAll('.textLayer span').forEach(span => {
      if (span.dataset.rawText) {
        span.textContent = span.dataset.rawText;
      }
      span.classList.remove('search-match');
    });
  }

  destroy() {
    if (this.pdfDoc) {
      try {
        this.pdfDoc.destroy();
      } catch (e) {}
      this.pdfDoc = null;
    }
    if (this.spreadView) {
      this.spreadView.innerHTML = '';
    }
  }

  calculateScale(baseViewport, visiblePagesCount = 1) {
    if (this.scaleMode === 'custom') {
      return this.customScale;
    }
    if (this.scaleMode === '100') {
      return 1.0;
    }

    // Absolute precise bounds calculation with safety margin
    const containerW = Math.max(100, this.container.clientWidth);
    const containerH = Math.max(100, this.container.clientHeight);

    // Margins (account for 12px padding on spread view + extra safety buffer)
    const availW = Math.max(50, containerW - 32);
    const availH = Math.max(50, containerH - 32);

    // In spread view mode, calculate against 2-page width so all pages (including cover) remain uniform
    const pagesInSpread = (this.viewMode === 'spread') ? 2 : 1;

    // Calculate total required width and height for spread
    const targetW = (baseViewport.width * pagesInSpread) + ((pagesInSpread > 1) ? 8 : 0);
    const targetH = baseViewport.height;

    const scaleW = availW / targetW;
    const scaleH = availH / targetH;

    if (this.scaleMode === 'fit-width') {
      // In spread view mode, fit-width should fit within screen bounds to prevent clipping
      if (this.viewMode === 'spread') {
        return Math.min(scaleW, scaleH);
      }
      return scaleW;
    } else {
      return Math.min(scaleW, scaleH);
    }
  }

  setThemeMode(mode) {
    this.themeMode = mode;
    this.applyThemeFilters();
  }

  setBrightness(val) {
    this.brightness = val;
    this.applyThemeFilters();
  }

  setContrast(val) {
    this.contrast = val;
    this.applyThemeFilters();
  }

  applyThemeFilters() {
    const pageCards = this.container.querySelectorAll('.pdf-page-card');
    
    let baseFilter = '';
    if (this.themeMode === 'dark') {
      baseFilter = `invert(0.88) hue-rotate(180deg) contrast(92%) brightness(95%)`;
    } else if (this.themeMode === 'sepia') {
      baseFilter = `sepia(0.35) contrast(95%) brightness(95%)`;
    }

    const bFilter = `brightness(${this.brightness}%)`;
    const cFilter = `contrast(${this.contrast}%)`;

    const combinedFilter = `${baseFilter} ${bFilter} ${cFilter}`.trim();

    pageCards.forEach(card => {
      card.style.filter = combinedFilter;
      if (this.themeMode === 'dark') {
        card.style.background = '#161c28';
        card.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.12)';
      } else {
        card.style.background = '#ffffff';
        card.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)';
      }
    });
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.render();
  }

  setBindingMode(mode) {
    this.bindingMode = mode;
    this.render();
  }

  setHasCoverPage(hasCover) {
    this.hasCoverPage = hasCover;
    this.render();
  }

  setScaleMode(mode, customVal = 1.0) {
    this.scaleMode = mode;
    if (mode === 'custom') this.customScale = customVal;
    this.render();
  }

  resetZoomToOneTouch() {
    this.currentCssScale = 1.0;
    this.translateX = 0;
    this.translateY = 0;
    this.setScaleMode('fit-height');
  }

  goToPage(pageNum) {
    if (!this.pdfDoc) return;
    const target = Math.min(Math.max(1, pageNum), this.totalPages);
    if (target !== this.currentPage) {
      this.currentPage = target;
      this.render();
    }
  }

  nextPage() {
    if (!this.pdfDoc) return;
    let step = 1;
    if (this.viewMode === 'spread') {
      step = (this.hasCoverPage && this.currentPage === 1) ? 1 : 2;
    }
    this.goToPage(this.currentPage + step);
  }

  prevPage() {
    if (!this.pdfDoc) return;
    let step = 1;
    if (this.viewMode === 'spread') {
      step = 2;
    }
    this.goToPage(this.currentPage - step);
  }

  initMouseWheelEvents() {
    let lastWheelTime = 0;
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.ctrlKey) {
        const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1;
        const newScale = Math.min(Math.max(0.3, (this.scaleMode === 'custom' ? this.customScale : this.lastComputedScale) + zoomDelta), 3.0);
        this.setScaleMode('custom', newScale);
        return;
      }

      const now = Date.now();
      if (now - lastWheelTime < 250) return;
      lastWheelTime = now;

      if (e.deltaY > 0) {
        this.nextPage();
      } else if (e.deltaY < 0) {
        this.prevPage();
      }
    }, { passive: false });
  }

  clampTranslation() {
    if (this.currentCssScale <= 1.02) {
      this.translateX = 0;
      this.translateY = 0;
      return;
    }

    const spreadWidth = this.spreadView.offsetWidth || this.container.clientWidth;
    const spreadHeight = this.spreadView.offsetHeight || this.container.clientHeight;

    const scaledW = spreadWidth * this.currentCssScale;
    const scaledH = spreadHeight * this.currentCssScale;

    const maxTx = Math.max(0, (scaledW - this.container.clientWidth) / 2);
    const maxTy = Math.max(0, (scaledH - this.container.clientHeight) / 2);

    this.translateX = Math.min(Math.max(-maxTx, this.translateX), maxTx);
    this.translateY = Math.min(Math.max(-maxTy, this.translateY), maxTy);
  }

  applyTransform() {
    if (this.currentCssScale <= 1.02 && Math.abs(this.translateX) < 1 && Math.abs(this.translateY) < 1) {
      this.spreadView.style.transform = 'none';
    } else {
      this.spreadView.style.transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0px) scale(${this.currentCssScale})`;
    }
  }

  initTouchEvents() {
    let initialPinchDist = 0;
    let pinchStartScale = 1.0;
    let panStartX = 0;
    let panStartY = 0;
    let initialTx = 0;
    let initialTy = 0;
    let lastTapTime = 0;

    const getPinchDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    this.container.addEventListener('touchstart', (e) => {
      // Double Tap Reset
      if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTapTime < 280) {
          this.resetZoomToOneTouch();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;

        // Start 1-finger panning if zoomed in
        if (this.currentCssScale > 1.05) {
          panStartX = e.touches[0].clientX;
          panStartY = e.touches[0].clientY;
          initialTx = this.translateX;
          initialTy = this.translateY;
        }
      }

      if (e.touches.length === 2) {
        initialPinchDist = getPinchDistance(e.touches);
        pinchStartScale = this.currentCssScale;
      }
    }, { passive: true });

    this.container.addEventListener('touchmove', (e) => {
      // 2-finger Pinch Zoom
      if (e.touches.length === 2 && initialPinchDist > 0) {
        e.preventDefault();
        const currentDist = getPinchDistance(e.touches);
        const factor = currentDist / initialPinchDist;
        
        this.currentCssScale = Math.min(Math.max(0.9, pinchStartScale * factor), 3.5);
        this.clampTranslation();
        this.applyTransform();
      }
      // 1-finger Panning when zoomed in
      else if (e.touches.length === 1 && this.currentCssScale > 1.05) {
        const dx = e.touches[0].clientX - panStartX;
        const dy = e.touches[0].clientY - panStartY;
        
        this.translateX = initialTx + dx;
        this.translateY = initialTy + dy;
        this.clampTranslation();
        this.applyTransform();
      }
    }, { passive: false });

    this.container.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        initialPinchDist = 0;
        if (this.currentCssScale <= 1.05) {
          this.currentCssScale = 1.0;
          this.translateX = 0;
          this.translateY = 0;
          this.applyTransform();
        }
      }
    }, { passive: true });
  }
}
