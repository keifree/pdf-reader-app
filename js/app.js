/**
 * Antigravity PDF Studio - Master Application Controller
 * Optimized & Cleaned Architecture with Keyboard Shortcuts (Undo/Redo/Esc),
 * Multi-Tab Engine, Fast Drive Sync, Position Persistence, & Layer Toggles.
 */

import { PDFViewer } from './pdf-viewer.js';
import { AnnotationManager } from './annotation-manager.js';
import { GoogleDriveManager } from './google-drive.js';
import { PDFExporter } from './pdf-exporter.js';

class App {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.readingHistoryKey = 'pdf_studio_reading_history';

    this.viewerContainer = document.getElementById('viewer-container');
    this.spreadView = document.getElementById('pdf-spread-view');
    this.commentsContainer = document.getElementById('comments-list');
    this.toastContainer = document.getElementById('toast-container');
    this.tabListElement = document.getElementById('tab-list');

    this.viewer = new PDFViewer(this.viewerContainer, this.spreadView);
    this.annotator = new AnnotationManager(this.commentsContainer);
    this.driveManager = new GoogleDriveManager();

    this.initEvents();
    this.initKeyboardShortcuts();
    this.initDraggableToolbar();
    this.initSampleTab();
  }

  getReadingHistory() {
    try {
      return JSON.parse(localStorage.getItem(this.readingHistoryKey)) || {};
    } catch (e) {
      return {};
    }
  }

  saveReadingState(fileKey, state) {
    if (!fileKey) return;
    const history = this.getReadingHistory();
    history[fileKey] = {
      currentPage: state.currentPage || 1,
      bindingMode: state.bindingMode || 'rtl',
      viewMode: state.viewMode || 'spread',
      hasCoverPage: state.hasCoverPage !== false,
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(this.readingHistoryKey, JSON.stringify(history));
    } catch (e) {}
  }

  getSavedReadingState(fileKey) {
    if (!fileKey) return null;
    const history = this.getReadingHistory();
    return history[fileKey] || null;
  }

  getFileStorageKey(tab) {
    return tab.driveFile?.id ? `drive_${tab.driveFile.id}` : `local_${tab.fileName}`;
  }

  initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // 1. Page Navigation Shortcuts
      if (e.key === 'ArrowRight') {
        if (this.viewer.bindingMode === 'rtl') this.viewer.prevPage();
        else this.viewer.nextPage();
      } else if (e.key === 'ArrowLeft') {
        if (this.viewer.bindingMode === 'rtl') this.viewer.nextPage();
        else this.viewer.prevPage();
      }

      // 2. Undo (Ctrl+Z) & Redo (Ctrl+Y or Ctrl+Shift+Z)
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          if (e.shiftKey) {
            if (this.annotator.redo()) this.showToast('やり直し (Redo)', 'info');
          } else {
            if (this.annotator.undo()) this.showToast('元に戻す (Undo)', 'info');
          }
        } else if (e.key.toLowerCase() === 'y') {
          if (this.annotator.redo()) this.showToast('やり直し (Redo)', 'info');
        }
      }

      // 3. Escape key to reset tool to select cursor
      if (e.key === 'Escape') {
        this.resetToolToSelect();
      }
    });
  }

  resetToolToSelect() {
    const toolButtons = document.querySelectorAll('.annot-btn[data-tool]');
    toolButtons.forEach(b => b.classList.remove('active'));
    const selectBtn = document.querySelector('.annot-btn[data-tool="select"]');
    if (selectBtn) selectBtn.classList.add('active');
    this.annotator.setTool('select');
  }

  initEvents() {
    // 1. Page Navigation
    document.getElementById('btn-prev').onclick = () => this.viewer.prevPage();
    document.getElementById('btn-next').onclick = () => this.viewer.nextPage();

    // Auto-resize handler for iPad rotation
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.viewer.render();
      }, 200);
    });

    this.viewer.onPageChange = (current, total) => {
      document.getElementById('current-page-num').value = current;
      document.getElementById('total-pages').textContent = total;
      
      const scrubberSlider = document.getElementById('page-scrubber-slider');
      if (scrubberSlider) {
        scrubberSlider.max = total;
        scrubberSlider.value = current;
      }

      // Sync Floating Page Slider
      const floatingLabel = document.getElementById('floating-page-label');
      const floatingSlider = document.getElementById('floating-page-slider');
      if (floatingLabel) floatingLabel.textContent = `P. ${current} / ${total}`;
      if (floatingSlider) {
        floatingSlider.max = total;
        floatingSlider.value = current;
      }

      const activeTab = this.getActiveTab();
      if (activeTab) {
        activeTab.currentPage = current;
        this.saveReadingState(this.getFileStorageKey(activeTab), activeTab);
      }
      setTimeout(() => this.annotator.attachToPageCards(), 100);
    };

    document.getElementById('current-page-num').onchange = (e) => {
      const pageNum = parseInt(e.target.value, 10);
      if (!isNaN(pageNum)) this.viewer.goToPage(pageNum);
    };

    let sliderThrottleTimer = null;
    const syncSliderDrag = (slider) => {
      if (!slider) return;

      const handleSliderInput = (e) => {
        const p = parseInt(e.target.value, 10);
        if (isNaN(p)) return;

        // Immediately update page labels on UI
        const pageInput = document.getElementById('current-page-num');
        const floatingLabel = document.getElementById('floating-page-label');
        if (pageInput) pageInput.value = p;
        if (floatingLabel) floatingLabel.textContent = `P. ${p} / ${this.viewer.totalPages}`;

        // Sync sibling sliders
        const sidebarSlider = document.getElementById('page-scrubber-slider');
        const floatSlider = document.getElementById('floating-page-slider');
        if (sidebarSlider && sidebarSlider !== slider) sidebarSlider.value = p;
        if (floatSlider && floatSlider !== slider) floatSlider.value = p;

        // Throttle canvas page rendering so JS thread doesn't freeze
        if (!sliderThrottleTimer) {
          sliderThrottleTimer = setTimeout(() => {
            sliderThrottleTimer = null;
            this.viewer.goToPage(p);
          }, 40);
        }
      };

      slider.oninput = handleSliderInput;
      slider.onchange = (e) => {
        clearTimeout(sliderThrottleTimer);
        sliderThrottleTimer = null;
        const p = parseInt(e.target.value, 10);
        if (!isNaN(p)) this.viewer.goToPage(p);
      };

      slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
      slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
      slider.addEventListener('pointerdown', (e) => e.stopPropagation());
    };

    syncSliderDrag(document.getElementById('page-scrubber-slider'));
    syncSliderDrag(document.getElementById('floating-page-slider'));

    // 5. Dynamic Zoom Sync & Reset Buttons
    const zoomSelect = document.getElementById('zoom-select');




    // Touch Swipe / Flick Gesture Handler
    let touchStartX = 0;
    let touchStartY = 0;
    this.viewerContainer.addEventListener('touchstart', (e) => {
      if (this.annotator.currentTool !== 'select') return;
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    this.viewerContainer.addEventListener('touchend', (e) => {
      if (this.annotator.currentTool !== 'select') return;

      // DO NOT flip page on swipe if zoomed in or if viewer has scroll overflow
      const isZoomedIn = (this.viewer.currentCssScale > 1.05) || 
                         (this.viewer.scaleMode === 'custom' && this.viewer.customScale > 1.05) ||
                         (this.viewerContainer.scrollWidth > this.viewerContainer.clientWidth + 15) ||
                         (this.viewerContainer.scrollHeight > this.viewerContainer.clientHeight + 15) ||
                         (this.viewer.scaleMode !== 'fit-height' && this.viewer.scaleMode !== 'fit-width');

      if (isZoomedIn) return; // Allow smooth panning/scrolling without flipping pages!

      if (e.changedTouches.length === 1) {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;

        // Horizontal swipe threshold: > 40px, Vertical threshold: < 60px
        if (Math.abs(deltaX) > 40 && Math.abs(deltaY) < 60) {
          if (deltaX < 0) {
            // Swipe Left -> Next Page in LTR, Prev Page in RTL
            if (this.viewer.bindingMode === 'rtl') this.viewer.prevPage();
            else this.viewer.nextPage();
          } else {
            // Swipe Right -> Prev Page in LTR, Next Page in RTL
            if (this.viewer.bindingMode === 'rtl') this.viewer.nextPage();
            else this.viewer.prevPage();
          }
        }
      }
    }, { passive: true });

    // 2. View Mode Toggle
    document.getElementById('opt-view-spread').onclick = (e) => {
      this.setActivePill('#opt-view-spread, #opt-view-single', e.target);
      this.viewer.setViewMode('spread');
      const tab = this.getActiveTab();
      if (tab) {
        tab.viewMode = 'spread';
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      document.getElementById('cover-mode-section').style.opacity = '1.0';
      document.getElementById('cover-mode-section').style.pointerEvents = 'auto';
      this.showToast('【見開き】モード', 'info');
    };

    document.getElementById('opt-view-single').onclick = (e) => {
      this.setActivePill('#opt-view-spread, #opt-view-single', e.target);
      this.viewer.setViewMode('single');
      const tab = this.getActiveTab();
      if (tab) {
        tab.viewMode = 'single';
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      document.getElementById('cover-mode-section').style.opacity = '0.4';
      document.getElementById('cover-mode-section').style.pointerEvents = 'none';
      this.showToast('【単一ページ】モード', 'info');
    };

    // 3. Binding Direction Toggle
    document.getElementById('opt-rtl').onclick = (e) => {
      this.setActivePill('#opt-rtl, #opt-ltr', e.target);
      this.viewer.setBindingMode('rtl');
      const tab = this.getActiveTab();
      if (tab) {
        tab.bindingMode = 'rtl';
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      this.showToast('右綴じ（RTL）モード', 'info');
    };

    document.getElementById('opt-ltr').onclick = (e) => {
      this.setActivePill('#opt-rtl, #opt-ltr', e.target);
      this.viewer.setBindingMode('ltr');
      const tab = this.getActiveTab();
      if (tab) {
        tab.bindingMode = 'ltr';
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      this.showToast('左綴じ（LTR）モード', 'info');
    };

    // 4. Cover Page Toggle
    document.getElementById('opt-cover-on').onclick = (e) => {
      this.setActivePill('#opt-cover-on, #opt-cover-off', e.target);
      this.viewer.setHasCoverPage(true);
      const tab = this.getActiveTab();
      if (tab) {
        tab.hasCoverPage = true;
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      this.showToast('【表紙あり】モード', 'info');
    };

    document.getElementById('opt-cover-off').onclick = (e) => {
      this.setActivePill('#opt-cover-on, #opt-cover-off', e.target);
      this.viewer.setHasCoverPage(false);
      const tab = this.getActiveTab();
      if (tab) {
        tab.hasCoverPage = false;
        this.saveReadingState(this.getFileStorageKey(tab), tab);
      }
      this.showToast('【表紙なし】モード', 'info');
    };

    // 5. Visual Theme Modes & Brightness/Contrast Sliders
    document.getElementById('theme-normal').onclick = (e) => {
      this.setActivePill('#theme-normal, #theme-dark, #theme-sepia', e.target);
      this.viewer.setThemeMode('normal');
      this.showToast('通常表示テーマ', 'info');
    };

    document.getElementById('theme-dark').onclick = (e) => {
      this.setActivePill('#theme-normal, #theme-dark, #theme-sepia', e.target);
      this.viewer.setThemeMode('dark');
      this.showToast('目に優しいダークモード', 'info');
    };

    document.getElementById('theme-sepia').onclick = (e) => {
      this.setActivePill('#theme-normal, #theme-dark, #theme-sepia', e.target);
      this.viewer.setThemeMode('sepia');
      this.showToast('セピア紙面モード', 'info');
    };

    document.getElementById('brightness-slider').oninput = (e) => {
      this.viewer.setBrightness(parseInt(e.target.value, 10));
    };

    document.getElementById('contrast-slider').oninput = (e) => {
      this.viewer.setContrast(parseInt(e.target.value, 10));
    };

    // 6. Collapsible Split Docks & iPad Fullscreen Mode
    const leftDock = document.getElementById('left-dock');
    const rightSidebar = document.getElementById('right-sidebar');
    const triggerLeft = document.getElementById('trigger-open-left');
    const triggerRight = document.getElementById('trigger-open-right');
    const btnCollapseLeft = document.getElementById('btn-collapse-left');
    const btnCollapseRight = document.getElementById('btn-collapse-right');

    const toggleLeftDock = (collapse) => {
      if (collapse === undefined) collapse = !leftDock.classList.contains('collapsed');
      leftDock.classList.toggle('collapsed', collapse);
      triggerLeft.style.display = collapse ? 'flex' : 'none';
      setTimeout(() => this.viewer.render(), 260);
    };

    const toggleRightSidebar = (collapse) => {
      if (collapse === undefined) collapse = !rightSidebar.classList.contains('collapsed');
      rightSidebar.classList.toggle('collapsed', collapse);
      triggerRight.style.display = collapse ? 'flex' : 'none';
      setTimeout(() => this.viewer.render(), 260);
    };

    if (btnCollapseLeft) btnCollapseLeft.onclick = () => toggleLeftDock(true);
    if (triggerLeft) triggerLeft.onclick = () => toggleLeftDock(false);

    if (btnCollapseRight) btnCollapseRight.onclick = () => toggleRightSidebar(true);
    if (triggerRight) triggerRight.onclick = () => toggleRightSidebar(false);

    // Auto-collapse docks on iPad / narrow screens for immersive reading
    if (window.innerWidth <= 1024) {
      toggleLeftDock(true);
      toggleRightSidebar(true);
    }

    this.annotator.onCommentJump = (pageNum, commentId) => {
      this.viewer.goToPage(pageNum);
      setTimeout(() => this.annotator.pulsePinMarker(commentId), 150);
      this.showToast(`P.${pageNum} の注釈ピンへジャンプしました 📍`, 'info');
    };

    const layerMap = [
      { id: 'layer-stroke', key: 'strokes', label: '手書き・ハイライト' },
      { id: 'layer-shape', key: 'shapes', label: '直線・矢印・引出線' },
      { id: 'layer-text', key: 'text', label: 'テキスト注釈' },
      { id: 'layer-pin', key: 'pins', label: 'ピン注釈' }
    ];

    layerMap.forEach(l => {
      const btn = document.getElementById(l.id);
      if (btn) {
        btn.onclick = () => {
          const isVisible = this.annotator.toggleLayer(l.key);
          btn.classList.toggle('active', isVisible);
          this.showToast(`【${l.label}】を${isVisible ? '表示' : '非表示'}にしました`, 'info');
        };
      }
    });

    // 7. Cache Management Buttons
    document.getElementById('btn-clear-memory').onclick = () => {
      if (this.tabs.length <= 1) {
        this.showToast('解放する非アクティブタブがありません', 'info');
        return;
      }
      const activeTab = this.getActiveTab();
      this.tabs = [activeTab];
      this.renderTabsUI();
      this.showToast('背景タブのメモリを解放しました 🧹', 'success');
    };

    document.getElementById('btn-clear-history').onclick = () => {
      if (confirm('保存されている閲覧ページ履歴をすべて初期化しますか？')) {
        localStorage.removeItem(this.readingHistoryKey);
        this.showToast('読書履歴キャッシュを消去しました 🗑️', 'success');
      }
    };

    // 8. Zoom Controls
    document.getElementById('zoom-select').onchange = (e) => {
      const val = e.target.value;
      if (['fit-width', 'fit-height', '100'].includes(val)) {
        this.viewer.setScaleMode(val);
      } else {
        this.viewer.setScaleMode('custom', parseFloat(val) / 100);
      }
    };

    this.viewer.onZoomChange = (mode, percent) => {
      const zoomSelect = document.getElementById('zoom-select');
      if (!zoomSelect) return;
      if (['fit-height', 'fit-width', '100'].includes(mode)) {
        zoomSelect.value = mode;
      } else {
        const valStr = String(percent);
        let matchOpt = Array.from(zoomSelect.options).find(opt => opt.value === valStr);
        if (!matchOpt) {
          const prevCustom = zoomSelect.querySelector('option.custom-opt');
          if (prevCustom) prevCustom.remove();

          matchOpt = document.createElement('option');
          matchOpt.className = 'custom-opt';
          matchOpt.value = valStr;
          matchOpt.textContent = `${percent}% (カスタム)`;
          zoomSelect.appendChild(matchOpt);
        }
        zoomSelect.value = valStr;
      }
    };

    // 9. Annotation Tool Buttons Toggle
    const toolButtons = document.querySelectorAll('.annot-btn[data-tool]');
    toolButtons.forEach(btn => {
      btn.onclick = () => {
        const tool = btn.dataset.tool;
        toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.annotator.setTool(tool);

        const toolLabels = {
          select: '選択モード',
          pen: '手書きペン',
          line: '直線 / 蛍光ハイライト描画',
          arrow: '矢印描画',
          text: 'テキスト入力',
          callout: '引出線テキスト',
          comment: 'ピン注釈追加',
          eraser: '消しゴム'
        };
        this.showToast(`${toolLabels[tool] || tool} モード`, 'info');
      };
    });

    const colorDots = document.querySelectorAll('.color-dot');
    colorDots.forEach(dot => {
      dot.onclick = () => {
        const color = dot.dataset.color;
        this.annotator.setColor(color);
        colorDots.forEach(d => d.style.borderColor = 'transparent');
        dot.style.borderColor = '#ffffff';
      };
    });

    const colorPicker = document.getElementById('custom-color-picker');
    if (colorPicker) {
      colorPicker.onchange = (e) => this.annotator.setColor(e.target.value);
    }

    // 1-Tap Stroke Width Preset Buttons
    const widthBtns = document.querySelectorAll('.width-btn');
    widthBtns.forEach(btn => {
      btn.onclick = () => {
        const w = parseInt(btn.dataset.width, 10);
        this.annotator.setStrokeWidth(w);
        widthBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const leftStroke = document.getElementById('left-stroke-width-slider');
        const strokeLabel = document.getElementById('stroke-width-val-label');
        if (leftStroke) leftStroke.value = w;
        if (strokeLabel) strokeLabel.textContent = `${w}px`;
        this.showToast(`線の太さ: ${w}px`, 'info');
      };
    });

    const leftStroke = document.getElementById('left-stroke-width-slider');
    const strokeLabel = document.getElementById('stroke-width-val-label');
    if (leftStroke) {
      leftStroke.oninput = (e) => {
        const numVal = parseInt(e.target.value, 10);
        this.annotator.setStrokeWidth(numVal);
        if (strokeLabel) strokeLabel.textContent = `${numVal}px`;
      };
    }

    const opacitySlider = document.getElementById('opacity-slider');
    const opacityLabel = document.getElementById('opacity-val-label');
    if (opacitySlider && opacityLabel) {
      opacitySlider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        opacityLabel.textContent = `${val}%`;
        this.annotator.setOpacity(val / 100);
      };
    }

    // 10. File Loading Events
    document.getElementById('file-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        const arrayBuffer = await file.arrayBuffer();
        this.addTab(file.name, arrayBuffer, null);
      }
    };

    document.getElementById('btn-open-file').onclick = () => document.getElementById('file-input').click();
    document.getElementById('btn-new-tab').onclick = () => document.getElementById('file-input').click();

    // 11. Google Drive Integration
    document.getElementById('btn-gdrive-open').onclick = async () => {
      try {
        if (!this.driveManager.clientId) {
          this.openDriveConfigModal();
          return;
        }
        await this.driveManager.openPicker();
      } catch (err) {
        console.error('Google Drive error:', err);
        this.showToast(`Google Drive エラー: ${err.message || '連携失敗'}`, 'warning');
      }
    };

    this.driveManager.onFileLoaded = (buffer, name) => {
      const driveFile = this.driveManager.currentDriveFile;
      this.addTab(name, buffer, driveFile);
      document.getElementById('drive-status-badge').style.display = 'inline-flex';
    };

    const saveDriveConfigHandler = async () => {
      const clientId = document.getElementById('input-gdrive-client-id').value.trim();
      if (clientId) {
        this.driveManager.setClientId(clientId);
        this.closeDriveConfigModal();
        this.showToast('Google Drive Client IDを保存しました', 'success');
        try {
          await this.driveManager.openPicker();
        } catch (err) {
          console.error('Google Drive error:', err);
          this.showToast(`Google Drive エラー: ${err.message || '連携失敗'}`, 'warning');
        }
      } else {
        this.showToast('OAuth Client IDを入力してください', 'warning');
      }
    };

    document.getElementById('btn-save-gdrive-config').onclick = saveDriveConfigHandler;
    document.getElementById('gdrive-config-form').onsubmit = (e) => {
      e.preventDefault();
      saveDriveConfigHandler();
    };

    document.getElementById('btn-close-modal').onclick = () => this.closeDriveConfigModal();

    // 12. Save & Export
    document.getElementById('btn-save-drive').onclick = async () => {
      const activeTab = this.getActiveTab();
      if (!activeTab || !activeTab.buffer) {
        this.showToast('保存するPDFデータがありません', 'warning');
        return;
      }


      try {
        this.showToast('Google Driveへ上書き保存中...', 'info');
        this.driveManager.currentDriveFile = activeTab.driveFile;
        const exportBuffer = await PDFExporter.exportPDF(
          activeTab.buffer,
          this.annotator.annotations,
          this.viewer.bindingMode
        );
        const result = await this.driveManager.saveFileToDrive(exportBuffer, activeTab.fileName);
        activeTab.driveFile = { id: result.id, name: result.name };
        this.showToast('Google Drive上のファイルを更新しました！', 'success');
      } catch (err) {
        console.error(err);
        this.showToast(`Drive保存エラー: ${err.message}`, 'warning');
      }
    };

    document.getElementById('btn-download-pdf').onclick = async () => {
      const activeTab = this.getActiveTab();
      if (!activeTab || !activeTab.buffer) return;


      try {
        this.showToast('右綴じ属性と注釈を埋め込んでダウンロード中...', 'info');
        const exportBuffer = await PDFExporter.exportPDF(
          activeTab.buffer,
          this.annotator.annotations,
          this.viewer.bindingMode
        );

        const blob = new Blob([exportBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `[右綴じ済]_${activeTab.fileName}`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('PDFをダウンロードしました', 'success');
      } catch (err) {
        console.error(err);
        this.showToast('PDF書き出しエラー', 'warning');
      }
    };

    // 13. PDF Transparent Text & OCR Search Bar Event Handlers
    const btnToggleSearch = document.getElementById('btn-toggle-search');
    const searchBarContainer = document.getElementById('search-bar-container');
    const searchInput = document.getElementById('search-input');
    const searchCountLabel = document.getElementById('search-count-label');
    const btnSearchPrev = document.getElementById('btn-search-prev');
    const btnSearchNext = document.getElementById('btn-search-next');
    const btnSearchClose = document.getElementById('btn-search-close');

    const toggleSearchBar = (show) => {
      if (!searchBarContainer) return;
      if (show === undefined) show = searchBarContainer.style.display === 'none';
      searchBarContainer.style.display = show ? 'flex' : 'none';
      if (show && searchInput) {
        searchInput.focus();
        searchInput.select();
      } else {
        this.viewer.clearSearchHighlights();
      }
    };

    if (btnToggleSearch) btnToggleSearch.onclick = () => toggleSearchBar();
    if (btnSearchClose) btnSearchClose.onclick = () => toggleSearchBar(false);

    let searchDebounce;
    if (searchInput) {
      searchInput.oninput = () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(async () => {
          const query = searchInput.value;
          const { totalMatches, currentIndex, totalTextLength } = await this.viewer.searchDocument(query);
          if (searchCountLabel) {
            searchCountLabel.textContent = totalMatches > 0 ? `${currentIndex + 1} / ${totalMatches}` : '0 / 0';
          }
          if (query && query.trim() !== '') {
            if (totalMatches > 0) {
              this.showToast(`【検索成功】"${query.trim()}" : ${totalMatches}件ヒット`, 'info');
            } else if (totalTextLength === 0) {
              this.showToast(`【注意】このPDFには読み取り可能なテキスト層が含まれていません (抽出: 0文字)`, 'warning');
            } else {
              this.showToast(`【検索結果 0件】"${query.trim()}" (全${totalTextLength}文字中)`, 'warning');
            }
          }
        }, 300);
      };

      searchInput.onkeydown = async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) {
            await this.viewer.jumpToSearchMatch(this.viewer.currentSearchIndex - 1);
          } else {
            await this.viewer.jumpToSearchMatch(this.viewer.currentSearchIndex + 1);
          }
          if (searchCountLabel && this.viewer.searchResults) {
            searchCountLabel.textContent = `${this.viewer.currentSearchIndex + 1} / ${this.viewer.searchResults.length}`;
          }
        } else if (e.key === 'Escape') {
          toggleSearchBar(false);
        }
      };
    }

    if (btnSearchPrev) {
      btnSearchPrev.onclick = async () => {
        if (this.viewer.searchResults && this.viewer.searchResults.length > 0) {
          await this.viewer.jumpToSearchMatch(this.viewer.currentSearchIndex - 1);
          if (searchCountLabel) {
            searchCountLabel.textContent = `${this.viewer.currentSearchIndex + 1} / ${this.viewer.searchResults.length}`;
          }
        }
      };
    }

    if (btnSearchNext) {
      btnSearchNext.onclick = async () => {
        if (this.viewer.searchResults && this.viewer.searchResults.length > 0) {
          await this.viewer.jumpToSearchMatch(this.viewer.currentSearchIndex + 1);
          if (searchCountLabel) {
            searchCountLabel.textContent = `${this.viewer.currentSearchIndex + 1} / ${this.viewer.searchResults.length}`;
          }
        }
      };
    }
  }

  initDraggableToolbar() {
    const toolbar = document.getElementById('floating-draw-toolbar');
    const handle = document.getElementById('draw-toolbar-drag-handle');
    const orientBtn = document.getElementById('btn-toggle-toolbar-orient');
    if (!toolbar || !handle) return;

    // Load saved orientation layout (vertical / horizontal)
    const savedOrient = localStorage.getItem('draw_toolbar_orient') || 'vertical';
    toolbar.classList.remove('vertical', 'horizontal');
    toolbar.classList.add(savedOrient);

    // Clamp toolbar so it never goes offscreen on iPad rotation or resize
    const clampToolbarToWindow = () => {
      const rect = toolbar.getBoundingClientRect();
      const maxLeft = Math.max(5, window.innerWidth - rect.width - 5);
      const maxTop = Math.max(5, window.innerHeight - rect.height - 5);

      let currentLeft = parseFloat(toolbar.style.left) || rect.left;
      let currentTop = parseFloat(toolbar.style.top) || rect.top;

      currentLeft = Math.min(Math.max(5, currentLeft), maxLeft);
      currentTop = Math.min(Math.max(5, currentTop), maxTop);

      toolbar.style.left = `${currentLeft}px`;
      toolbar.style.top = `${currentTop}px`;
      toolbar.style.right = 'auto';
    };

    if (orientBtn) {
      const doToggle = (e) => {
        if (e) {
          e.stopPropagation();
          e.preventDefault();
        }
        const isCurrentlyVert = toolbar.classList.contains('vertical');
        const nextOrient = isCurrentlyVert ? 'horizontal' : 'vertical';
        toolbar.classList.remove('vertical', 'horizontal');
        toolbar.classList.add(nextOrient);
        localStorage.setItem('draw_toolbar_orient', nextOrient);
        clampToolbarToWindow();
        this.showToast(`ツールバー: ${nextOrient === 'horizontal' ? '横型' : '縦型'}レイアウト`, 'info');
      };

      orientBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      orientBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
      orientBtn.onclick = doToggle;
    }

    const savedPos = localStorage.getItem('draw_toolbar_pos');
    if (savedPos) {
      try {
        const { left, top } = JSON.parse(savedPos);
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
        toolbar.style.right = 'auto';
      } catch (e) {}
    }

    const handleResizeOrRotate = () => {
      clampToolbarToWindow();
      setTimeout(clampToolbarToWindow, 150);
      setTimeout(clampToolbarToWindow, 450);
    };

    clampToolbarToWindow();
    window.addEventListener('resize', handleResizeOrRotate);
    window.addEventListener('orientationchange', handleResizeOrRotate);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResizeOrRotate);
    }

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const startDrag = (clientX, clientY) => {
      isDragging = true;
      const rect = toolbar.getBoundingClientRect();
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
      toolbar.style.right = 'auto';
    };

    const moveDrag = (clientX, clientY) => {
      if (!isDragging) return;
      let newX = clientX - offsetX;
      let newY = clientY - offsetY;

      newX = Math.min(Math.max(5, newX), window.innerWidth - toolbar.offsetWidth - 5);
      newY = Math.min(Math.max(5, newY), window.innerHeight - toolbar.offsetHeight - 5);

      toolbar.style.left = `${newX}px`;
      toolbar.style.top = `${newY}px`;
    };

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      const rect = toolbar.getBoundingClientRect();
      localStorage.setItem('draw_toolbar_pos', JSON.stringify({ left: rect.left, top: rect.top }));
    };

    handle.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('touchend', endDrag, { passive: true });

    handle.addEventListener('mousedown', (e) => {
      startDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) moveDrag(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', endDrag);
  }

  setActivePill(selectorGroup, targetElement) {
    document.querySelectorAll(selectorGroup).forEach(el => el.classList.remove('active'));
    targetElement.classList.add('active');
  }

  addTab(fileName, arrayBuffer, driveFile = null) {
    const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    
    const tempTab = { fileName, driveFile };
    const storageKey = this.getFileStorageKey(tempTab);
    const savedState = this.getSavedReadingState(storageKey);

    const newTab = {
      id: tabId,
      fileName,
      buffer: arrayBuffer.slice(0),
      annotations: {},
      driveFile,
      currentPage: savedState ? savedState.currentPage : 1,
      bindingMode: savedState ? savedState.bindingMode : 'rtl',
      viewMode: savedState ? savedState.viewMode : 'spread',
      hasCoverPage: savedState ? savedState.hasCoverPage : true
    };

    this.tabs.push(newTab);
    this.renderTabsUI();
    this.switchTab(tabId);

    if (savedState && savedState.currentPage > 1) {
      this.showToast(`「${fileName}」を前回の続き（P.${savedState.currentPage}）から開きました 🔖`, 'info');
    } else {
      this.showToast(`「${fileName}」を開きました`, 'success');
    }
  }

  async switchTab(tabId) {
    const targetTab = this.tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    this.activeTabId = tabId;

    this.viewer.bindingMode = targetTab.bindingMode;
    this.viewer.viewMode = targetTab.viewMode;
    this.viewer.hasCoverPage = targetTab.hasCoverPage;
    this.annotator.annotations = targetTab.annotations;

    this.setActivePill('#opt-rtl, #opt-ltr', document.getElementById(targetTab.bindingMode === 'rtl' ? 'opt-rtl' : 'opt-ltr'));
    this.setActivePill('#opt-view-spread, #opt-view-single', document.getElementById(targetTab.viewMode === 'spread' ? 'opt-view-spread' : 'opt-view-single'));
    this.setActivePill('#opt-cover-on, #opt-cover-off', document.getElementById(targetTab.hasCoverPage ? 'opt-cover-on' : 'opt-cover-off'));

    this.renderTabsUI();
    this.annotator.renderSidebarComments();

    await this.viewer.loadDocument(targetTab.buffer.slice(0), targetTab.currentPage);

    try {
      if (this.viewer.pdfDoc && typeof this.viewer.pdfDoc.getAttachments === 'function') {
        const attachments = await this.viewer.pdfDoc.getAttachments();
        if (attachments && attachments['antigravity_annotations.json']) {
          const jsonBytes = attachments['antigravity_annotations.json'].content;
          const jsonStr = new TextDecoder().decode(jsonBytes);
          this.annotator.importAnnotations(jsonStr);
          targetTab.annotations = this.annotator.annotations;
        }
      }
    } catch (e) {
      console.warn('Could not extract embedded annotations:', e);
    }
  }

  closeTab(tabId, event) {
    if (event) event.stopPropagation();
    if (this.tabs.length <= 1) {
      this.showToast('最後のタブは閉じられません', 'warning');
      return;
    }

    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index !== -1) {
      const closedTab = this.tabs.splice(index, 1)[0];
      // Free buffer memory for closed tab
      closedTab.buffer = null;
      closedTab.annotations = null;

      if (this.activeTabId === tabId) {
        const nextActiveTab = this.tabs[Math.max(0, index - 1)];
        this.switchTab(nextActiveTab.id);
      } else {
        this.renderTabsUI();
      }
    }
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  renderTabsUI() {
    this.tabListElement.innerHTML = '';
    this.tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${tab.id === this.activeTabId ? 'active' : ''}`;
      tabEl.onclick = () => this.switchTab(tab.id);

      const icon = tab.driveFile ? '☁️' : '📄';
      tabEl.innerHTML = `
        <span>${icon}</span>
        <span class="tab-title" title="${tab.fileName}">${tab.fileName}</span>
        <button class="tab-close-btn" title="閉じる">×</button>
      `;

      tabEl.querySelector('.tab-close-btn').onclick = (e) => this.closeTab(tab.id, e);
      this.tabListElement.appendChild(tabEl);
    });
  }

  async initSampleTab() {
    try {
      const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const pageColors = [
        { name: '1 (表紙)', bg: rgb(0.12, 0.16, 0.23), text: rgb(1, 1, 1) },
        { name: '2 (ページA)', bg: rgb(0.96, 0.96, 0.98), text: rgb(0.1, 0.1, 0.2) },
        { name: '3 (ページB)', bg: rgb(0.96, 0.96, 0.98), text: rgb(0.1, 0.1, 0.2) },
        { name: '4 (ページC)', bg: rgb(0.96, 0.96, 0.98), text: rgb(0.1, 0.1, 0.2) },
        { name: '5 (奥付)', bg: rgb(0.18, 0.22, 0.32), text: rgb(1, 1, 1) }
      ];

      for (let i = 0; i < pageColors.length; i++) {
        const page = pdfDoc.addPage([500, 700]);
        const { width, height } = page.getSize();
        
        page.drawRectangle({
          x: 0, y: 0, width, height,
          color: pageColors[i].bg
        });

        page.drawText(`ANTIGRAVITY PDF STUDIO`, {
          x: 40, y: height - 60, size: 16, font, color: pageColors[i].text
        });

        page.drawText(`PAGE ${pageColors[i].name}`, {
          x: 40, y: height / 2, size: 26, font, color: pageColors[i].text
        });

        page.drawText(`Right-Binding Manga & Book Sample`, {
          x: 40, y: 40, size: 12, font, color: rgb(0.6, 0.6, 0.7)
        });
      }

      const pdfBytes = await pdfDoc.save();
      this.addTab('sample_manga_doc.pdf', pdfBytes.buffer, null);
    } catch (err) {
      console.warn('Sample PDF creation fallback:', err);
    }
  }

  openDriveConfigModal() {
    const modal = document.getElementById('gdrive-config-modal');
    modal.classList.add('open');
    document.getElementById('input-gdrive-client-id').value = this.driveManager.clientId;
  }

  closeDriveConfigModal() {
    document.getElementById('gdrive-config-modal').classList.remove('open');
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
      <span>${message}</span>
    `;
    this.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.pdfApp = new App();
});
