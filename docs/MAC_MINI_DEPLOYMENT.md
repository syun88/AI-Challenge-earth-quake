# QuakeLens Japan — Mac mini 本番サーバー運用手順書

Google AI Challenge 2026 向けの **QuakeLens Japan (`AI-Challenge-earth-quake`)** 本番サーバー（Mac mini）の構成・運用・デプロイ・監視・復旧手順をまとめたドキュメントです。

---

## 1. 本番環境サマリー

| 項目 | 値 |
| --- | --- |
| 公開URL (HTTPS / Tailscale Funnel) | `https://syuns-mac-mini.tail375645.ts.net` |
| 本番ホスト | `syuns-Mac-mini` (Apple M2 / arm64 / 8 GB RAM / macOS 27.2.1) |
| SSH 接続エイリアス | `ssh macmini` (`syun@100.87.150.22`, 鍵認証 `~/.ssh/id_ed25519`) |
| Mac mini プロジェクトパス | `/Users/syun/AI-Challenge-earth-quake` |
| バックアップ保存先 | `/Users/syun/AI-Challenge-earth-quake-backups/` |
| ログ保存先 | `/Users/syun/Library/Logs/quakelens/` |
| 公開エントリポイント | Tailscale Funnel (`:443`) → `http://127.0.0.1:3000` (単一入口) |
| Frontend (Next.js 本番) | `127.0.0.1:3000` (loopback 限定) |
| Backend (FastAPI / Uvicorn) | `127.0.0.1:8000` (loopback 限定、1 worker) |
| データベース | SQLite (`~/AI-Challenge-earth-quake/backend/data/board.db`, `chmod 600`) |

---

## 2. 本番システム構成

```text
Internet (HTTPS :443, Let's Encrypt 自動TLS証明書)
    |
Tailscale Funnel (https://syuns-mac-mini.tail375645.ts.net)
    |
    v
Next.js Production Server (127.0.0.1:3000, com.quakelens.frontend)
    |-- 静的ページ / UI / Live2D もちまもアセット / MapLibre Worker
    |-- /api/* (同一オリジンサーバー間リバースプロキシ)
            |
            v
        FastAPI / Uvicorn (127.0.0.1:8000, com.quakelens.backend, 1 worker)
            |-- Gemini API (サーバー側 .env のみで保持)
            |-- SQLite (backend/data/board.db)
            |-- 建物・メッシュ・道路・避難所データ (backend/data/processed, jshis_cache)
            |-- 気象庁 / P2PQuake リアルタイム地震・災害データ
```

### 設計上の重要ポイント
- **単一公開入口**: `3000` / `8000` ともに `127.0.0.1` にのみバインドし、Tailscale IPv4 や LAN からは直接到達不可。外部へは Tailscale Funnel の `:443` のみを開放しています。
- **同一オリジン通信**: ブラウザからの `/api/*` および建物 MVT ベクトルタイル `/api/tiles/buildings/{z}/{x}/{y}.pbf` はすべて同一オリジン（`https://syuns-mac-mini.tail375645.ts.net`）へ送信され、Next.js API Route が内部的に `http://127.0.0.1:8000` へ中継します。
- **メモリ最適化 (8 GB RAM)**: 513,815 棟の建物データをメモリに展開するため、Uvicorn は `--workers 1` に固定しています（通常時 Backend 約 940 MiB、Frontend 約 125 MiB）。

---

## 3. インストール済みランタイム（Mac mini）

- **Node.js**: Homebrew `node@22` (`v22.23.5`, keg-only: `/opt/homebrew/opt/node@22/bin/node`)
- **Python**: Homebrew `python@3.12` (`3.12.16`, `/opt/homebrew/bin/python3.12`)
- **uv**: Homebrew `uv` (`0.13.10`, `/opt/homebrew/bin/uv`)
- **Tailscale CLI**: `/Applications/Tailscale.app/Contents/MacOS/Tailscale`（稼働中 MacSys アプリとバージョン一致）

> **注意**: `node@22` は keg-only のため、非対話シェルや `launchd` から `node`/`npm` を呼ぶ場合は必ず `PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/bin:/bin"` または絶対パスを指定します。

---

## 4. launchd サービス一覧（常時稼働・自動復旧）

すべての定義は `/Users/syun/Library/LaunchAgents/` に配置されています（秘密情報は `.plist` に含めず、`chmod 600` の `.env` / `frontend/.env.local` から実行時に読み込みます）。

| ラベル | 役割 | 自動起動 / 自動再起動 | ログ |
| --- | --- | --- | --- |
| `com.quakelens.backend` | FastAPI (`127.0.0.1:8000`, 1 worker) | `RunAtLoad` / `KeepAlive` (`ThrottleInterval=5`) | `~/Library/Logs/quakelens/backend.{out,err}.log` |
| `com.quakelens.frontend` | Next.js 本番 (`127.0.0.1:3000`) | `RunAtLoad` / `KeepAlive` (`ThrottleInterval=5`) | `~/Library/Logs/quakelens/frontend.{out,err}.log` |
| `com.quakelens.caffeinate` | `caffeinate -s -i` によるアイドルスリープ抑止 | `RunAtLoad` / `KeepAlive` | なし |
| `com.quakelens.logrotate` | 毎日 04:15 に 10 MB 超のログを copytruncate 圧縮ローテーション（最大3世代） | `StartCalendarInterval` | `~/Library/Logs/quakelens/logrotate.{out,err}.log` |

---

## 5. 運用スクリプトの使い方

すべてのスクリプトはリポジトリ直下の `scripts/` に配置されています。`deploy_macmini.sh` は MacBook Pro から実行し、その他のスクリプトは **MacBook Pro（SSH 経由自動実行）と Mac mini 本体のどちらからでも** 実行できます。

### 5.1 稼働状態の確認
```bash
./scripts/production_status.sh
```
以下を一括表示します:
- `launchd` サービス状態と PID
- リッスンポート (`127.0.0.1:3000`, `127.0.0.1:8000`)
- プロセスのメモリ使用量 (RSS)
- ローカル・公開 HTTPS `/api/health` 応答
- Tailscale Funnel 状態
- SQLite `PRAGMA integrity_check` と各テーブル件数
- ディスク空き容量と直近のエラーログ

### 5.2 コード修正後の本番デプロイ（MacBook Pro → Mac mini）
```bash
# 変更差分の事前確認（ドライラン）
./scripts/deploy_macmini.sh --dry-run

# 本番反映（自動バックアップ → 非破壊 rsync → 依存更新・本番ビルド → 秘密情報非露出検査 → 再起動 → ヘルスチェック）
./scripts/deploy_macmini.sh
```

オプション:
- `--skip-backend-deps`: Python 依存（`pyproject.toml` / `uv.lock`）に変更がない場合に高速化
- `--skip-frontend-build`: フロントエンドに変更がない場合に高速化

> **安全設計**:
> - `rsync --delete` は使用しません。
> - 本番の `.env`、`frontend/.env.local`、`backend/data/board.db` は **絶対に上書きしません**。
> - デプロイ前に `~/AI-Challenge-earth-quake-backups/<YYYYMMDD-HHMMSS>/` へコードスナップショットと `sqlite3 .backup` を自動保存します（最新10世代保持）。

### 5.3 サービスの再起動
```bash
./scripts/restart_production.sh
```

### 5.4 サービスの起動 / 停止 / 公開停止
```bash
# サービス起動 + Tailscale Funnel 有効化
./scripts/start_production.sh

# サービスのみ停止（Tailscale Funnel 設定は維持）
./scripts/stop_production.sh

# サービス停止 + 外部公開 (Tailscale Funnel) も完全に停止
./scripts/stop_production.sh --unpublish
```

公開だけを即座に止めたい場合（Mac mini 上または SSH 経由）:
```bash
ssh macmini '/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --https=443 off'
```

### 5.5 ロールバック（直前のリリースへ戻す）
```bash
# 利用可能なバックアップ一覧を確認
./scripts/rollback_production.sh --list

# 最新バックアップへロールバック（.env と稼働中 board.db は保護されます）
./scripts/rollback_production.sh

# 特定のタイムスタンプ ID へロールバック
./scripts/rollback_production.sh 20261128-143500
```

> データベース自体を過去のバックアップへ戻す必要がある場合は、誤上書きを防ぐため手動で `stop_production.sh` 実行後に `~/AI-Challenge-earth-quake-backups/<ID>/board.db` を `backend/data/board.db` へコピーし、`PRAGMA integrity_check;` を確認してから `start_production.sh` を実行してください。

### 5.6 ログの確認
```bash
# リアルタイム監視（Backend / Frontend）
ssh macmini 'tail -f ~/Library/Logs/quakelens/backend.err.log ~/Library/Logs/quakelens/frontend.out.log ~/Library/Logs/quakelens/frontend.err.log'

# 直近100行確認
ssh macmini 'tail -n 100 ~/Library/Logs/quakelens/backend.err.log'
```

---

## 6. 本番環境変数（Mac mini `.env`）

Mac mini 上の `/Users/syun/AI-Challenge-earth-quake/.env`（権限 `600`）に設定されているキー名一覧（値は非記載）:

- `GEMINI_API_KEY`: Gemini API キー（サーバー側のみで使用）
- `FIREBASE_PROJECT_ID`: Firebase ID トークン検証用プロジェクト ID
- `GOV_REGISTRATION_CODE`: 政府関連機関ロール登録コード
- `CORS_ALLOW_ORIGINS`: `https://syuns-mac-mini.tail375645.ts.net,http://localhost:3000,http://127.0.0.1:3000`
- `DISABLE_OPENAPI_DOCS`: `true`（`/docs`, `/openapi.json` を 404 化）
- `BACKEND_INTERNAL_URL`: `http://127.0.0.1:8000`
- `AI_ALLOW_PREMIUM_MODELS`: `false`（課金悪用防止）
- `AI_DAILY_BUDGET_REQUESTS`: `300`（日次リクエスト上限）

フロントエンド用の公開設定は `/Users/syun/AI-Challenge-earth-quake/frontend/.env.local`（権限 `600`）に `NEXT_PUBLIC_FIREBASE_*` のみ配置しています。

---

## 7. 事前確認・管理者操作が必要な事項

### 7.1 Firebase Authentication「承認済みドメイン」の追加（Google ログイン用）
公開 URL で **Google アカウントログイン（`signInWithPopup`）** を利用する場合、Firebase Console 側で公開ドメインを許可する必要があります。
1. Firebase Console → 対象プロジェクト → **Authentication** → **Settings** → **Authorized domains（承認済みドメイン）**
2. **「ドメインを追加」** から `syuns-mac-mini.tail375645.ts.net` を追加して保存

### 7.2 停電復旧・macOS 再起動後の完全無人自動復旧（任意・管理者権限要）
現在の Mac mini では `com.quakelens.caffeinate` によりアイドルスリープを抑止していますが、OS レベルの電源設定（`pmset`）と自動ログインは以下の状態です:
- `pmset -g`: `sleep 1`, `disksleep 10`, `autorestart 0`
- `autoLoginUser`: 未設定
- Tailscale は MacSys GUI アプリ（ユーザーログインセッション配下）で動作中

停電や再起動後もログイン操作なしで完全自動復旧させたい場合は、Mac mini 上で管理者権限により以下を設定してください:
1. 電源設定の恒久化:
   ```bash
   sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1
   ```
2. macOS **システム設定 → ユーザとグループ → 自動ログイン** で `syun` を設定し、ログイン項目に `Tailscale.app` が含まれていることを確認してください（FileVault が有効な場合は自動ログイン不可のため、再起動後は一度ログインが必要です）。
