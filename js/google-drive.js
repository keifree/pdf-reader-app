/**
 * Antigravity PDF Studio - Google Drive Integration Module
 * Integrates Google Drive API v3 & Google Picker API.
 * Streams PDFs directly into browser memory (ArrayBuffer) without downloading to local disk,
 * and saves edited PDFs back to Google Drive using RFC multipart/related encoding.
 */

export class GoogleDriveManager {
  constructor() {
    this.clientId = localStorage.getItem('gdrive_client_id') || '';
    this.lastFolderId = localStorage.getItem('gdrive_last_folder_id') || 'root';
    this.lastFolderPath = localStorage.getItem('gdrive_last_folder_path') || '';
    this.accessToken = null;
    this.isDriveConnected = false;
    this.currentDriveFile = null; // { id, name }

    this.onFileLoaded = null;
    this.onStatusChange = null;

    this.initGapiClient();
  }

  setClientId(clientId) {
    this.clientId = clientId.trim();
    localStorage.setItem('gdrive_client_id', this.clientId);
    // Reset cached token when client ID changes
    this.accessToken = null;
    this.initGapiClient();
  }

  initGapiClient() {
    if (!this.clientId) return;

    if (!window.gapi) {
      const script1 = document.createElement('script');
      script1.src = 'https://apis.google.com/js/api.js';
      script1.onload = () => {
        gapi.load('picker', () => console.log('Google Picker API loaded'));
      };
      document.head.appendChild(script1);
    }

    if (!window.google?.accounts?.oauth2) {
      const script2 = document.createElement('script');
      script2.src = 'https://accounts.google.com/gsi/client';
      document.head.appendChild(script2);
    }
  }

  async authenticate(forcePrompt = false) {
    if (!this.clientId) {
      throw new Error('Google Client IDが未設定です。ヘッダーの「Drive」ボタンからClient IDを入力してください。');
    }

    if (this.accessToken && !forcePrompt) {
      return this.accessToken;
    }

    // Wait for google accounts oauth2 script if still loading
    if (!window.google?.accounts?.oauth2) {
      await new Promise((resolve) => {
        let count = 0;
        const interval = setInterval(() => {
          count++;
          if (window.google?.accounts?.oauth2 || count > 30) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }

    if (!window.google?.accounts?.oauth2) {
      throw new Error('Google認証スクリプトのロードに失敗しました。インターネット接続をご確認ください。');
    }

    return new Promise((resolve, reject) => {
      try {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          // Scope for full Google Drive file read & write access
          scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file',
          prompt: forcePrompt ? 'consent' : '',
          callback: (response) => {
            if (response.error) {
              reject(response);
            } else {
              this.accessToken = response.access_token;
              this.isDriveConnected = true;
              if (this.onStatusChange) this.onStatusChange(true);
              resolve(this.accessToken);
            }
          },
        });
        client.requestAccessToken();
      } catch (err) {
        reject(err);
      }
    });
  }

  async getFileParentId(fileId) {
    try {
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,parents`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data.parents && data.parents.length > 0) {
          return data.parents[0];
        }
      }
    } catch (err) {
      console.warn('Failed to fetch parent folder ID:', err);
    }
    return null;
  }

  initBrowserUI() {
    this.modalEl = document.getElementById('gdrive-browser-modal');
    if (!this.modalEl) return;

    this.fileListEl = document.getElementById('gdrive-file-list');
    this.breadcrumbsEl = document.getElementById('gdrive-breadcrumbs');
    this.loadingEl = document.getElementById('gdrive-loading-spinner');
    this.emptyEl = document.getElementById('gdrive-empty-state');
    this.itemCountEl = document.getElementById('gdrive-item-count');
    this.searchInputEl = document.getElementById('gdrive-search-input');
    this.searchClearBtn = document.getElementById('gdrive-search-clear');
    this.btnUp = document.getElementById('gdrive-btn-up');

    // Tab buttons
    this.tabMyDrive = document.getElementById('gdrive-tab-mydrive');
    this.tabShared = document.getElementById('gdrive-tab-shared');
    this.tabRecent = document.getElementById('gdrive-tab-recent');

    // Close buttons
    const btnClose = document.getElementById('btn-close-gdrive-browser');
    const btnCancel = document.getElementById('btn-cancel-gdrive-browser');

    if (btnClose) btnClose.onclick = () => this.closeBrowser();
    if (btnCancel) btnCancel.onclick = () => this.closeBrowser();

    // Backdrop click
    this.modalEl.onclick = (e) => {
      if (e.target === this.modalEl) this.closeBrowser();
    };

    // Tab click handlers
    if (this.tabMyDrive) {
      this.tabMyDrive.onclick = () => this.switchTab('mydrive');
    }
    if (this.tabShared) {
      this.tabShared.onclick = () => this.switchTab('shared');
    }
    if (this.tabRecent) {
      this.tabRecent.onclick = () => this.switchTab('recent');
    }

    // Up button handler
    if (this.btnUp) {
      this.btnUp.onclick = () => this.navigateUp();
    }

    // Search input handler
    if (this.searchInputEl) {
      this.searchInputEl.oninput = () => {
        const query = this.searchInputEl.value.trim().toLowerCase();
        if (this.searchClearBtn) {
          this.searchClearBtn.style.display = query ? 'block' : 'none';
        }
        this.filterItems(query);
      };
    }
    if (this.searchClearBtn) {
      this.searchClearBtn.onclick = () => {
        this.searchInputEl.value = '';
        this.searchClearBtn.style.display = 'none';
        this.filterItems('');
      };
    }
  }

  switchTab(source) {
    this.currentSource = source;
    [this.tabMyDrive, this.tabShared, this.tabRecent].forEach(tab => {
      if (tab) tab.classList.remove('active');
    });

    if (source === 'mydrive' && this.tabMyDrive) this.tabMyDrive.classList.add('active');
    if (source === 'shared' && this.tabShared) this.tabShared.classList.add('active');
    if (source === 'recent' && this.tabRecent) this.tabRecent.classList.add('active');

    if (source === 'mydrive') {
      const folderId = this.lastFolderId || 'root';
      this.loadFolder(folderId);
    } else if (source === 'shared') {
      this.loadFolder('shared');
    } else if (source === 'recent') {
      this.loadFolder('recent');
    }
  }

  closeBrowser() {
    if (this.modalEl) {
      this.modalEl.classList.remove('open');
    }
    if (this._browserReject) {
      this._browserReject(new Error('ファイル選択がキャンセルされました'));
      this._browserReject = null;
      this._browserResolve = null;
    }
  }

  /**
   * Main entry point to open Google Drive File Browser (replacing openPicker)
   */
  async openPicker() {
    await this.authenticate();

    if (!this.modalEl) {
      this.initBrowserUI();
    }

    if (this.modalEl) {
      this.modalEl.classList.add('open');
    }

    this.currentSource = 'mydrive';
    if (this.tabMyDrive) this.tabMyDrive.classList.add('active');
    if (this.tabShared) this.tabShared.classList.remove('active');
    if (this.tabRecent) this.tabRecent.classList.remove('active');

    if (this.searchInputEl) {
      this.searchInputEl.value = '';
      if (this.searchClearBtn) this.searchClearBtn.style.display = 'none';
    }

    const startFolderId = this.lastFolderId || 'root';

    return new Promise((resolve, reject) => {
      this._browserResolve = resolve;
      this._browserReject = reject;
      this.loadFolder(startFolderId);
    });
  }

  async loadFolder(folderId) {
    this.currentFolderId = folderId;
    if (this.loadingEl) this.loadingEl.style.display = 'flex';
    if (this.fileListEl) this.fileListEl.innerHTML = '';
    if (this.emptyEl) this.emptyEl.style.display = 'none';
    if (this.itemCountEl) this.itemCountEl.textContent = '読み込み中...';

    // Update breadcrumbs in parallel
    this.updateBreadcrumbs(folderId);

    try {
      let query = '';
      let orderBy = 'folder,name';

      if (this.currentSource === 'mydrive') {
        query = `'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')`;
      } else if (this.currentSource === 'shared') {
        query = `sharedWithMe = true and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')`;
      } else if (this.currentSource === 'recent') {
        query = `trashed = false and mimeType = 'application/pdf'`;
        orderBy = 'viewedByMeTime desc';
      }

      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=${encodeURIComponent(orderBy)}&fields=files(id,name,mimeType,modifiedTime,size,parents)&pageSize=100`;

      let response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });

      if (response.status === 401) {
        this.accessToken = null;
        await this.authenticate();
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
      }

      // Fallback: If 404 (folder no longer exists), reset to root
      if (response.status === 404 && folderId !== 'root') {
        console.warn('Folder not found (404). Falling back to root...');
        this.lastFolderId = 'root';
        localStorage.setItem('gdrive_last_folder_id', 'root');
        return this.loadFolder('root');
      }

      if (!response.ok) {
        throw new Error(`Google Driveの一覧取得に失敗しました (${response.status})`);
      }

      const data = await response.json();
      const files = data.files || [];

      // Sort: Folders first, then alphabetically by name
      files.sort((a, b) => {
        const aIsFolder = a.mimeType === 'application/vnd.google-apps.folder';
        const bIsFolder = b.mimeType === 'application/vnd.google-apps.folder';
        if (aIsFolder && !bIsFolder) return -1;
        if (!aIsFolder && bIsFolder) return 1;
        return a.name.localeCompare(b.name, 'ja');
      });

      this.currentItems = files;
      this.renderItems(files);
    } catch (err) {
      console.error('Failed to load folder:', err);
      if (this.fileListEl) {
        this.fileListEl.innerHTML = `<div style="color: #f87171; padding: 24px; text-align: center; font-size: 0.85rem;">エラー: ${err.message}</div>`;
      }
    } finally {
      if (this.loadingEl) this.loadingEl.style.display = 'none';
    }
  }

  async updateBreadcrumbs(folderId) {
    if (!this.breadcrumbsEl) return;
    this.breadcrumbsEl.innerHTML = '<span style="color: var(--text-muted);">...</span>';

    if (this.currentSource === 'shared') {
      this.breadcrumbsEl.innerHTML = `<span class="gdrive-crumb-item current">👥 共有アイテム</span>`;
      if (this.btnUp) this.btnUp.disabled = true;
      this.parentFolderId = null;
      return;
    }

    if (this.currentSource === 'recent') {
      this.breadcrumbsEl.innerHTML = `<span class="gdrive-crumb-item current">🕒 最近使用したファイル</span>`;
      if (this.btnUp) this.btnUp.disabled = true;
      this.parentFolderId = null;
      return;
    }

    // My Drive hierarchy traversal
    const crumbs = [];
    let currentId = folderId;
    let parentId = null;

    if (folderId === 'root') {
      crumbs.push({ id: 'root', name: 'マイドライブ' });
      this.parentFolderId = null;
      if (this.btnUp) this.btnUp.disabled = true;
    } else {
      for (let i = 0; i < 6; i++) {
        if (!currentId || currentId === 'root') break;
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${currentId}?fields=id,name,parents`, {
            headers: { Authorization: `Bearer ${this.accessToken}` }
          });
          if (!res.ok) break;
          const data = await res.json();
          crumbs.unshift({ id: data.id, name: data.name });
          if (i === 0 && data.parents && data.parents.length > 0) {
            parentId = data.parents[0];
          }
          currentId = (data.parents && data.parents.length > 0) ? data.parents[0] : null;
        } catch (e) {
          break;
        }
      }
      crumbs.unshift({ id: 'root', name: 'マイドライブ' });
      this.parentFolderId = parentId || 'root';
      if (this.btnUp) this.btnUp.disabled = false;
    }

    // Render breadcrumbs with full clickability
    this.breadcrumbsEl.innerHTML = '';
    crumbs.forEach((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      const crumbEl = document.createElement('span');
      crumbEl.className = isLast ? 'gdrive-crumb-item current' : 'gdrive-crumb-item';
      crumbEl.textContent = crumb.name;

      if (!isLast) {
        crumbEl.onclick = () => {
          this.loadFolder(crumb.id);
        };
      }

      this.breadcrumbsEl.appendChild(crumbEl);

      if (!isLast) {
        const sepEl = document.createElement('span');
        sepEl.className = 'gdrive-crumb-sep';
        sepEl.textContent = '▶';
        this.breadcrumbsEl.appendChild(sepEl);
      }
    });

    // Auto-scroll breadcrumbs bar to the rightmost end
    const breadcrumbBar = document.querySelector('.gdrive-breadcrumb-bar');
    if (breadcrumbBar) {
      breadcrumbBar.scrollLeft = breadcrumbBar.scrollWidth;
    }
  }

  navigateUp() {
    if (this.parentFolderId) {
      this.loadFolder(this.parentFolderId);
    }
  }

  renderItems(items) {
    if (!this.fileListEl) return;
    this.fileListEl.innerHTML = '';

    if (this.itemCountEl) {
      this.itemCountEl.textContent = `${items.length} 個のアイテム`;
    }

    if (items.length === 0) {
      if (this.emptyEl) this.emptyEl.style.display = 'flex';
      return;
    }

    if (this.emptyEl) this.emptyEl.style.display = 'none';

    items.forEach(file => {
      const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
      const itemEl = document.createElement('div');
      itemEl.className = `gdrive-item ${isFolder ? 'folder' : 'pdf'}`;

      const icon = isFolder ? '📁' : '📄';
      const dateStr = file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString('ja-JP') : '';
      const sizeStr = file.size ? this.formatFileSize(file.size) : '';

      itemEl.innerHTML = `
        <div class="gdrive-item-main">
          <div class="gdrive-item-icon">${icon}</div>
          <div class="gdrive-item-name" title="${file.name}">${file.name}</div>
        </div>
        <div class="gdrive-item-meta">
          <span>${dateStr}</span>
          ${sizeStr ? `<span>${sizeStr}</span>` : ''}
        </div>
      `;

      itemEl.onclick = async () => {
        if (isFolder) {
          this.loadFolder(file.id);
        } else {
          // PDF Selected
          await this.handleFileSelected(file);
        }
      };

      this.fileListEl.appendChild(itemEl);
    });
  }

  filterItems(query) {
    if (!this.currentItems) return;
    if (!query) {
      this.renderItems(this.currentItems);
      return;
    }

    const filtered = this.currentItems.filter(item => 
      item.name.toLowerCase().includes(query)
    );
    this.renderItems(filtered);
  }

  async handleFileSelected(file) {
    if (this.modalEl) {
      this.modalEl.classList.remove('open');
    }

    this.currentDriveFile = {
      id: file.id,
      name: file.name
    };

    // Save parent folder ID for smart resume
    if (this.currentFolderId && this.currentFolderId !== 'recent' && this.currentFolderId !== 'shared') {
      this.lastFolderId = this.currentFolderId;
      localStorage.setItem('gdrive_last_folder_id', this.currentFolderId);
    }

    try {
      const arrayBuffer = await this.downloadFileToBuffer(file.id);
      if (this.onFileLoaded) {
        this.onFileLoaded(arrayBuffer, file.name);
      }
      if (this._browserResolve) {
        this._browserResolve(file);
        this._browserResolve = null;
        this._browserReject = null;
      }
    } catch (err) {
      console.error('Download error:', err);
      alert(`ファイルのダウンロードに失敗しました: ${err.message}`);
    }
  }

  formatFileSize(bytes) {
    if (!bytes) return '';
    const num = parseInt(bytes, 10);
    if (isNaN(num)) return '';
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    return (num / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async downloadFileToBuffer(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    let response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`
      }
    });

    if (response.status === 401) {
      console.warn('Access token expired on download (401). Re-authenticating...');
      this.accessToken = null;
      await this.authenticate();
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`
        }
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Driveファイル読み込み失敗 (${response.status}: ${errText})`);
    }

    return await response.arrayBuffer();
  }

  /**
   * Upload / Overwrite PDF binary directly back to Google Drive
   */
  async saveFileToDrive(pdfArrayBuffer, fileName) {
    if (!this.accessToken) {
      await this.authenticate();
    }

    let fileId = this.currentDriveFile?.id;
    let targetName = fileName || 'Updated_Document.pdf';

    try {
      return await this._executeMultipartUpload(pdfArrayBuffer, targetName, fileId);
    } catch (err) {
      // Auto Re-auth: If 401 (token expired), re-authenticate and retry upload once
      if (err.message && (err.message.includes('401') || err.message.includes('invalid authentication credentials'))) {
        console.warn('Access token expired on save (401). Refreshing token and retrying upload...');
        this.accessToken = null;
        await this.authenticate();
        return await this._executeMultipartUpload(pdfArrayBuffer, targetName, fileId);
      }

      // Fallback: If 403 write permission denied on existing fileId, save as a new file in Drive
      if (fileId && err.message && err.message.includes('403')) {
        console.warn('Overwriting existing file denied. Creating a new file copy on Google Drive...');
        const newName = `[編集済]_${targetName}`;
        const newResult = await this._executeMultipartUpload(pdfArrayBuffer, newName, null);
        this.currentDriveFile = { id: newResult.id, name: newResult.name };
        return newResult;
      }
      throw err;
    }
  }

  async _executeMultipartUpload(pdfArrayBuffer, fileName, fileId = null) {
    const metadata = {
      name: fileName,
      mimeType: 'application/pdf',
    };

    let endpoint = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
      endpoint = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
      method = 'PATCH';
    }

    const boundary = '-------AntigravityPDFStudioBoundary' + Date.now();
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";

    const metadataContentType = 'Content-Type: application/json; charset=UTF-8\r\n\r\n';
    const mediaContentType = '\r\nContent-Type: application/pdf\r\n\r\n';

    const multipartRequestBody = new Blob([
      delimiter,
      metadataContentType,
      JSON.stringify(metadata),
      delimiter,
      mediaContentType,
      new Uint8Array(pdfArrayBuffer),
      closeDelimiter
    ], { type: `multipart/related; boundary=${boundary}` });

    const response = await fetch(endpoint, {
      method: method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!response.ok) {
      let errDetails = response.statusText;
      try {
        const errJson = await response.json();
        if (errJson.error && errJson.error.message) {
          errDetails = `${response.status} ${errJson.error.message}`;
        }
      } catch (e) {}
      throw new Error(`Google Drive保存失敗 (${errDetails})`);
    }

    return await response.json();
  }
}
