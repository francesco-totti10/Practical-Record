# Practical Record - Project Overview

「実践の本棚」は、Google Apps Script (GAS) を使用した教育実践記録管理ツールです。
スプレッドシートをデータベースとして利用し、Web UI を提供します。

## 開発ルール (Development Rules)
- **環境**: Google Apps Script (GAS)
- **ファイル構成**:
  - `Code.gs`: サーバーサイドロジック
  - `index.html`: メイン画面
  - `admin.html`: 管理画面
  - `library.html`: 図書館（閲覧）画面
- **データ永続化**: Google Sheets `教員名簿`, `実践記録` シートを使用
- **コーディング規約**:
  - スタイルは Vanilla CSS (HTML内に埋め込み)
  - ルーティングは `doGet(e)` で `page` パラメータを使用

## 技術スタック (Tech Stack)
- Google Apps Script
- Google Drive API (画像アップロード)
- HTML/CSS/JavaScript

## 同期とデプロイ
- Google Apps Script エディタにコードを反映してデプロイします。
- GitHub はソース管理用です。
