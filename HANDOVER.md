# PDF Studio Project Handover (v8.0.7)

新しいAIアシスタントへ：このファイルは、以前のセッションからの引き継ぎ資料です。ユーザーからの指示があった場合は、まずこのファイルを読んで現在のプロジェクトの仕様と背景を把握してください。

> **【最重要運用ルール：改修履歴の自動記録】**
> 今後、機能改修・バグ修正・アップデートを行い、ユーザーによる動作確認が完了した際は、**必ず本ファイルの「6. 改修・変更履歴（Decision & Change Log）」セクションに【何を・どんな風に・どうなったか】の形式で経緯を追記・コミットしてください**。将来のセッションで過去の判断や実装経緯を見失わないようにするためです。

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
* `js/app.js`: アプリ全体の状態管理、UIイベントのバインディング、Drive連携、エクスポート、添付JSON抽出、動的バージョン注入。
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
* **プッシュ手順**:
  * コミット作成後、GitHub Desktopを開いて右上の「Push origin」ボタンでプッシュする（Windows資格情報マネージャーの非対話プロンプト対策のためGitHub DesktopアプリからのPushを推奨）。
* **PWAキャッシュの注意**:
  * コード修正時は、ブラウザの強力なPWAキャッシュを更新するため、`index.html`、`sw.js`、`js/app.js` のバージョン番号（例: `v8.0.6` -> `v8.0.7`、`v406` -> `v407`）を必ずインクリメントしてください。

---

## 5. 現在の稼働ステータス (v8.0.7)
* **最新バージョン**: v8.0.7 (安定稼働中)
* **対応完了環境**: PC (Chrome/Edge), iPad (Safari/PWA), iPhone (Safari/PWA)
* **Google Drive連携**: OAuthトークン自動更新機能付きで安定動作。
* **PWAキャッシュ更新**: 設定サイドバー内の「🔄 アプリを最新に更新」ボタンにより、ホーム画面アプリでも即座に最新化可能。

---

## 6. 改修・変更履歴 (Decision & Change Log)

### 【v8.0.7】 2026-08-21: iOS/iPadOS PWAキャッシュ固定化の解消と動的更新機能の実装
* **① 何を（課題・不具合）**:
  * iPhone・iPadのPWA（ホーム画面アイコン）で、タスクキルを繰り返してもバージョン表記が「v8.0.4」のまま更新されない不具合が発生（PCブラウザはv8.0.6/v8.0.7で表示され、Drive自動認証等の内部ロジックはv8.0.5相当で動いているという不整合状態）。
* **② どんな風に（原因分析と改修内容）**:
  * **原因**: 静的HTML（`index.html`）に固定文字でバージョンが書かれており、iOS WebClip（ホーム画面PWA）のWebKitサンドボックスが `index.html` を強力にキャッシュ保持していた。また、iOS PWAには再読み込みボタンがなく、Service Worker更新時のリフレッシュ検知もなかった。
  * **改修**:
    1. `js/app.js`: `APP_VERSION = 'v8.0.7'` を定義し、起動時に `#app-version-badge` を強制上書き（動的同期）。
    2. `index.html`: `navigator.serviceWorker` の `controllerchange` イベントで自動リフレッシュする処理を追加。Cache-Controlメタタグを追加。
    3. `sw.js`: `CACHE_NAME = 'pdf-studio-v407'` に更新。ナビゲーション時は `cache: 'no-cache'` でサーバーから常に最新HTMLを取得するよう強化。
    4. `index.html` & `js/app.js`: 左サイドバーのキャッシュ管理に「🔄 アプリを最新に更新」ボタンを追加（caches全削除 + 全ServiceWorker解除 + キャッシュバスター付き強制リロード）。
* **③ どうなったか（結果・動作確認）**:
  * ユーザーによるiPhoneおよびiPadの実機確認にて、両端末とも **v8.0.7 への正常更新を確認完了**。
  * 今後はアイコン削除を行わなくても、サイドバーの更新ボタン1発またはService Worker自動検知で最新版に切り替わる体制が整った。

---

### 【v8.0.6】 2026-08-21: sw.js 内のキャッシュ対象ファイル名不整合の修正
* **① 何を**: PWAのService Workerキャッシュインストール（`cache.addAll`）が404エラーで失敗し、PWA更新が阻害されていた問題の解消。
* **② どんな風に**: `sw.js` 内で誤って参照されていた存在しない旧ファイル名 `./js/drive-manager.js` を、実在する `./js/google-drive.js` に修正。
* **③ どうなったか**: Service Workerの `install` イベントが正常に完走するようになった。

---

### 【v8.0.5】 2026-08-21: Google Drive 401 認証トークン切れの自動再取得＆リトライ
* **① 何を**: 1時間経過してGoogle OAuthトークンが失効した際に、Drive保存・読込で401 Unauthorizedエラーが発生していた問題の解消。
* **② どんな風に**: `google-drive.js` 内で 401 エラーを検知した際に、自動で `requestAccessToken()` を呼び出してトークンを再取得し、直前のAPIリクエストを自動リトライするフォールバック処理を実装。
* **③ どうなったか**: トークン失効時もユーザーが再設定することなくシームレスにDrive連携が継続するようになった。

---

### 【v8.0.4】 2026-08-21: 自己完結型 編集可能PDF（OCGレイヤー＋JSON埋め込み）アーキテクチャの確立
* **① 何を**: 他のPDFビューアでのアノテーション表示互換性と、本アプリでの再編集性（消しゴム消去・レイヤー切替）の両立。
* **② どんな風に**: `pdf-exporter.js` で `AntigravityLayer`（OCG）に線を焼き付けつつ、生JSONをPDF添付ファイル（EmbeddedFiles）に格納。`pdf-viewer.js` でOCGを非表示にし、`app.js` でJSONからCanvasに復元。
* **③ どうなったか**: 外部ビューアで閲覧可能でありながら、本アプリで開き直した際に完全に再編集可能なPDFファイル形式が完成した。

