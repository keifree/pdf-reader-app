# PDF Studio Project Handover (v8.0.6)

新しいAIアシスタントへ：このファイルは、以前のセッションからの引き継ぎ資料です。ユーザーからの指示があった場合は、まずこのファイルを読んで現在のプロジェクトの仕様と背景を把握してください。

---

## 1. プロジェクト概要
* **アプリ名**: Antigravity PDF Studio
* **公開URL (GitHub Pages)**: [https://keifree.github.io/pdf-reader-app/](https://keifree.github.io/pdf-reader-app/)
* **リポジトリ**: [https://github.com/keifree/pdf-reader-app](https://github.com/keifree/pdf-reader-app)
* **主な機能**: Google Driveと連携してPDFをブラウザ上で直接読み書きできるPWA（Progressive Web App）。複数タブ対応、右綴じ（漫画・和書向け）サポート、手書き・図形・テキストなどのアノテーション（注釈）機能。
* **技術スタック**: HTML / Vanilla JS / CSS (完全クライアントサイド動作)
  * PDF描画エンジン: `pdf.js` (Mozilla)
  * PDF出力・編集エンジン: `pdf-lib`

---

## 2. コアファイルの構成と役割
* `index.html`: アプリのUIレイアウト、PWAメタデータ設定、ツールバーUIなど。
* `style.css`: UIのスタイリング。
* `sw.js`: PWAのService Worker。`Network-First`戦略でキャッシュを管理。
* `js/app.js`: アプリ全体の状態管理、UIイベントのバインディング、Drive連携、エクスポート、添付JSON抽出。
* `js/pdf-viewer.js`: `pdf.js`を用いたPDFのレンダリング、OCG非表示制御、見開き表示、ページ移動機能。
* `js/annotation-manager.js`: ユーザーが画面上に書き込む線や図形、テキストのCanvasベースのUI描画とJSONデータ管理。
* `js/pdf-exporter.js`: `pdf-lib`を用いて、OCGレイヤーへの焼き付けとJSON添付ファイルの埋め込み処理。
* `js/google-drive.js`: Google Drive APIを利用したファイルの読み書き（OAuth2 / Picker API）。

---

## 3. 重要アーキテクチャ仕様 (必読)

### A. 自己完結型 編集可能PDF（OCGレイヤー＋JSON埋め込み方式）(v8.0.4)
* **保存時（`pdf-exporter.js`）**:
  1. PDF内に `AntigravityLayer` という名称の OCG（Optional Content Group）レイヤーを `PDFString.of('AntigravityLayer')` で定義。
  2. アノテーション（手書き線・図形・テキスト）をすべてこのレイヤー（`/OC /AntigravityLayer BDC ... EMC`）の中に焼き付け。
  3. キャンバスの生データ（JSON）を `antigravity_annotations.json` としてPDFのEmbeddedFiles（添付ファイル）に埋め込み。
* **読み込み時（`pdf-viewer.js` & `app.js`）**:
  1. `pdf-viewer.js` にて `pdfDoc.getOptionalContentConfig()` を取得し、`AntigravityLayer` の visibility を `false` に設定。
  2. レンダリング時（`page.render()`）に `optionalContentConfigPromise: Promise.resolve(this.ocgConfig)` を渡して、焼き付けられた線を不可視化。
  3. `app.js` にて `pdfDoc.getAttachments()` から `antigravity_annotations.json` を抽出し、`annotationManager.importAnnotations()` でCanvasレイヤーに復元。
* **効果**:
  * 外部PDFリーダー（iPhoneプレビュー、Acrobat等）では、OCGが標準表示されるため書き込みが確実に閲覧可能。
  * 本アプリで開き直した際は、焼き付け線が消え、編集可能なCanvas線として復元されるため、**保存後も消しゴムで消去可能・レイヤー非表示切替が可能**。
  * ファイルサイズはほぼ増加しません（数KBのJSONデータのみ）。

### B. 座標の正規化（パーセンテージベース化）
* デバイス間の解像度差（iPad / PC / スマホ）による描画ズレを防ぐため、アノテーションの座標（X, Y）やサイズはすべて**「PDFページ幅・高さに対する割合（0.0〜1.0）」**で保存・描画されています。

### C. テキスト・引出線の書き出し時エラー対策
* `pdf-lib` の日本語Unicode未対応を回避するため、`pdf-exporter.js` 内の `textToImage` / `renderCalloutToImage` メソッドでテキストをブラウザ上で一時的に高画質透過PNG画像に変換し、それをPDFに埋め込んでいます。

---

## 4. Git・開発・デプロイ環境
* **ローカルリポジトリ**: `C:\Users\k1082\.gemini\antigravity\scratch\pdf-reader-app`
* **GitHub Desktop連携**: ローカルリポジトリがGitHub Desktopと直接連携済みです。
* **AIによる自動Git操作**:
  * AIは以下のパスのGitコマンドを利用して、コード変更後に直接 commit & push を実行できます：
    ```powershell
    & "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" add .
    & "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" commit -m "コミットメッセージ"
    & "$env:LOCALAPPDATA\GitHubDesktop\app-*\resources\app\git\cmd\git.exe" push
    ```
* **PWAキャッシュの注意**:
  * コード修正時は、ブラウザの強力なPWAキャッシュを更新するため、`index.html` および `sw.js` のバージョン番号（例: `v8.0.4` -> `v8.0.5`、`v404` -> `v405`）を必ずインクリメントしてください。
