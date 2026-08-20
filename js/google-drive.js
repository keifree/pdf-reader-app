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

  /**
   * Recursively resolve path with smart ellipsis:
   * e.g. "マイドライブ ▶ ... ▶ 寺院関係 ▶ PDFライブラリ" (max 2 folders + root)
   */
  async getFolderPath(folderId) {
    if (!folderId || folderId === 'root') {
      return { titlePath: 'マイドライブ', tabLabel: 'マイドライブ' };
    }

    try {
      const pathParts = [];
      let currentId = folderId;

      // Trace up to 6 levels to avoid infinite recursion
      for (let i = 0; i < 6; i++) {
        if (!currentId || currentId === 'root') break;
        const url = `https://www.googleapis.com/drive/v3/files/${currentId}?fields=id,name,parents`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
        if (!res.ok) break;
        const data = await res.json();
        if (!data.name) break;
        pathParts.unshift(data.name);

        if (data.parents && data.parents.length > 0) {
          currentId = data.parents[0];
        } else {
          break;
        }
      }

      if (pathParts.length === 0) {
        return { titlePath: 'マイドライブ', tabLabel: 'マイドライブ' };
      }

      // Smart ellipsis: if deeper than 2 folders, show "マイドライブ ▶ ... ▶ 直前 ▶ 現在"
      if (pathParts.length > 2) {
        const tail = pathParts.slice(-2);
        const titlePath = `マイドライブ ▶ ... ▶ ${tail.join(' ▶ ')}`;
        const tabLabel = `📁 ... ▶ ${tail.join(' ▶ ')}`;
        return { titlePath, tabLabel };
      } else {
        const titlePath = `マイドライブ ▶ ${pathParts.join(' ▶ ')}`;
        const tabLabel = `📁 ${pathParts.join(' ▶ ')}`;
        return { titlePath, tabLabel };
      }
    } catch (err) {
      console.warn('Failed to resolve folder path:', err);
      return { titlePath: 'マイドライブ', tabLabel: 'マイドライブ' };
    }
  }

  async openPicker() {
    // Re-authenticate to ensure write permissions are granted
    await this.authenticate();

    if (!window.google?.picker) {
      throw new Error('Google Picker APIの読み込み中です。数秒後にもう一度お試しください。');
    }

    const lastFolderId = this.lastFolderId || localStorage.getItem('gdrive_last_folder_id') || 'root';

    // Immediately resolve folder path if subfolder to guarantee real-time title & tab label
    let folderInfo = { titlePath: 'マイドライブ', tabLabel: 'マイドライブ' };
    if (lastFolderId !== 'root') {
      folderInfo = await this.getFolderPath(lastFolderId);
      this.lastFolderPath = folderInfo.titlePath;
      localStorage.setItem('gdrive_last_folder_path', folderInfo.titlePath);
    }

    const isSubfolder = lastFolderId !== 'root';
    const currentFolderLabel = isSubfolder ? folderInfo.tabLabel : 'マイドライブ';
    const dialogTitle = isSubfolder ? `Google Drive (${folderInfo.titlePath})` : 'Google Drive';

    return new Promise((resolve) => {
      // 1. Current / Last Opened Folder View (Smart Resume)
      const currentFolderView = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setParent(lastFolderId)
        .setIncludeFolders(true)
        .setMimeTypes('application/pdf')
        .setSelectFolderEnabled(false)
        .setMode(google.picker.DocsViewMode.LIST)
        .setLabel(currentFolderLabel);

      const pickerBuilder = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .enableFeature(google.picker.Feature.SUPPORT_TEAM_DRIVES)
        .setTitle(dialogTitle)
        .addView(currentFolderView);

      // If lastFolderId is a subfolder, also provide a root "マイドライブ (最上位)" view tab
      if (isSubfolder) {
        const rootDriveView = new google.picker.DocsView(google.picker.ViewId.DOCS)
          .setParent('root')
          .setIncludeFolders(true)
          .setMimeTypes('application/pdf')
          .setSelectFolderEnabled(false)
          .setMode(google.picker.DocsViewMode.LIST)
          .setLabel('マイドライブ (最上位)');
        pickerBuilder.addView(rootDriveView);
      }

      // 2. Shared with me view with folder hierarchy navigation
      const sharedWithMeView = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setMimeTypes('application/pdf')
        .setSelectFolderEnabled(false)
        .setOwnedByMe(false)
        .setMode(google.picker.DocsViewMode.LIST)
        .setLabel('共有アイテム');

      // 3. Recently picked / modified view
      const recentView = new google.picker.DocsView(google.picker.ViewId.RECENTLY_PICKED)
        .setMimeTypes('application/pdf')
        .setMode(google.picker.DocsViewMode.LIST)
        .setLabel('最近使用したファイル');

      pickerBuilder
        .addView(sharedWithMeView)
        .addView(recentView)
        .setOAuthToken(this.accessToken)
        .setLocale('ja')
        .setCallback(async (data) => {
          if (data.action === google.picker.Action.PICKED) {
            const fileDoc = data.docs[0];
            this.currentDriveFile = {
              id: fileDoc.id,
              name: fileDoc.name
            };

            // Save parent folder ID and resolve breadcrumb path for smart resume
            let parentId = fileDoc.parentId;
            if (!parentId) {
              parentId = await this.getFileParentId(fileDoc.id);
            }
            if (parentId) {
              this.lastFolderId = parentId;
              localStorage.setItem('gdrive_last_folder_id', parentId);

              // Resolve full path asynchronously and cache it
              this.getFolderPath(parentId).then((info) => {
                this.lastFolderPath = info.titlePath;
                localStorage.setItem('gdrive_last_folder_path', info.titlePath);
              });
            }

            const arrayBuffer = await this.downloadFileToBuffer(fileDoc.id);
            if (this.onFileLoaded) {
              this.onFileLoaded(arrayBuffer, fileDoc.name);
            }
            resolve(fileDoc);
          }
        });

      const picker = pickerBuilder.build();
      picker.setVisible(true);
    });
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
