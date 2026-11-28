# QuakeLens Japan

**地震が起きる前から、起きた後まで。人命・文化・経済を守るAI防災プラットフォーム**

ここで公開してます
QuakeLens Japan
https://syuns-mac-mini.tail375645.ts.net

- **応募アワード**: **Google AI Challenge 2026**（Google Japan 25周年記念アワード）
- **応募部門**: **Society & Planet（まちと地球の未来部門）**
- **統合基盤**: 国土交通省 **Project PLATEAU（京都市513,815棟）** × 防災科研 **J-SHIS（2,990メッシュ・表層地盤V4）** × **京都市公式防災データ（514指定緊急避難場所・R8耐震リスト・11地震シナリオ）** × **気象庁** × **OpenStreetMap（41,813ノード / 58,360街路）** × **Firebase Authentication / Cloud Firestore** × **Gemini API（22 Function Calling ツール · Interactions API · Gemini TTS）**

> [!IMPORTANT]
> - 本プラットフォームの地震ハザード確率（`T30_I55_PS` 等）は「揺れの発生確率」に関する統計指標であり、**個別建物の倒壊確率予測や地震予知、建築士等による正式な耐震診断ではありません**。
> - 市民から投稿される被害報告はすべてサーバー側で **`unverified`（未確認・市民報告）** として強制管理し、公的発表や訓練用サンプルと明確に区別して表示します。
> - 歴史的建造物（築年ベース：1950年以前等）と法令上の正式な指定文化財を混同せず、企業BCP適地スコアも**公開データに基づく一次スクリーニング比較（安全性を保証しない）**として提示します。
> - 避難・救援・迂回経路シミュレーションおよび最適避難所自動選定は **OpenStreetMap主要幹線モデルを用いた訓練・研究用機能** であり、実災害時の道路安全性や実避難所の開設を保証するものではありません。発災時は自治体・警察・消防の公式指示を最優先してください。

---

## 1. Google AI Challenge 2026 審査基準との対応

| 審査基準 | QuakeLens Japan におけるアプローチ |
|---|---|
| **ORIGINALITY（独創性）** | 単なるハザードマップでも汎用チャットボットでもなく、**513,815棟の3D都市モデル・地盤・11地震シナリオ・実道路網**と **一般市民・企業（BCP）・政府関連機関のゼロトラスト3ロールRBAC** を統合し、**AIエージェントによる自律地図操作**と**Firestoreリアルタイム掲示板への `@もちまも` 参加**を融合。 |
| **IMPACT（社会・暮らしへの貢献度）** | **市民**は専門知識なしで自宅リスク・耐震対策・補助制度・避難経路を自然言語で把握でき、**企業**は他社や市民から機密隔離された重要設備の診断とBCP代替拠点比較を実施でき、**行政**は11起震帯・歴史的建造物と住宅のP1〜P4優先度・R8耐震リスト連携・CSV/Excel出力で予算配分を支援。平時から発災直後まで地域社会と人命・文化・経済を一貫して支えます。 |
| **AI UTILITY（AI活用の有効性）** | `google-genai` SDK（**Gemini Interactions API / SSEストリーミング / 22 Function Calling ツール**）により複雑な空間・災害データを自動横断照会。数値・建物ID・URLの**決定論的Grounding検証**（[grounding.py](backend/app/grounding.py)）、LLM実行前後の**RBACセキュリティガードレール**、**Gemini TTS（`Leda` 音声プリセット）＋ 15パーツ Live2D リップシンク**を実装。 |
| **SCALABILITY（展開可能性）** | 国土交通省 **Project PLATEAU 標準製品仕様書**、全国共通 **J-SHIS Web API**、**OpenStreetMap**、**Firebase / Cloud Firestore** に準拠しているため、前処理パイプラインの対象自治体コードと地域データを差し替えることで**京都から全国の自治体へ横展開可能**です。 |

---

## 2. 社会課題と「京都」を対象とした理由

事前防災（建物・地盤リスク、公的耐震支援、BCP立地）と発災後対応（安否確認、被害報告、避難所選定、救援経路調整）は窓口が分断されがちであり、一般市民・民間企業・自治体で必要な情報の粒度と守るべき機密も大きく異なります。

本プラットフォームでは当初候補とした東京23区（2020/2022年度PLATEAU CityGML）で標準の建築年属性（`bldg:yearOfConstruction`）が0%（未整備）だった事前検証を踏まえ、全国主要都市から **京都市（2025年度版 `plateau-26100-kyoto-shi-2025`）** を第1実証都市として選定しました。

| 指標・属性 | 実測カバー率 / 件数 |
|---|---|
| **対象範囲・建物総数** | 京都市全域11区・**513,815棟**（242メッシュファイル / **2,990メッシュ**） |
| **建築年判明率** | **80.9%**（判明 415,456棟：1981年以前 158,446棟 / 1982〜2000年 131,749棟 / 2001年以降 125,261棟 / **不明 98,359棟・19.1%は推測せず保持**） |
| **建物属性判明率** | 用途 **82.3%**（422,773棟） / 構造 **79.1%**（406,465棟） / 地上階数 **80.0%**（411,258棟） / 実測高さ **98.2%**（504,362棟） |
| **J-SHIS 震度6弱以上確率（30年）** | **0.5%〜58.3%**（砂礫質台地 531メッシュ平均 **5.4%** vs 伏見・山科等の後背湿地 399メッシュ平均 **54.7%**：地盤差と築年分布の重なりを明確に可視化） |
| **公式避難・耐震・地震データ** | 京都市指定緊急避難場所 **514件**（一次 444 + 広域 70）／R8市有建築物耐震性能リスト（949棟照合）／京都市11地震シナリオ |

---

## 3. 3つの利用者ロールとゼロトラスト権限制御（RBAC）

初回アクセス時は `/login` 認証ゲートが表示され、全3区分とも **「メールアドレス＋パスワード」「Googleアカウント」** の両方によるログイン・新規登録に対応しています（[`/guide`](frontend/src/app/guide/page.tsx) はログイン前でも閲覧可能）。

| 機能・データ領域 | 一般市民 (`citizen`) | 企業 (`enterprise`) | 政府関連機関 (`government`) |
|---|---|---|---|
| **新規登録要件** | 認証コード不要（即時登録可） | 認証コード不要（企業・組織名入力） | **要 機関認証コード (`GOV_REGISTRATION_CODE`)** |
| **公開災害・空間データ** | 全513,815棟・2,990メッシュ・514避難所・歴史×住宅P1〜P4・11地震帯を閲覧可 | 閲覧可（BCP基礎指標として参照） | 全域統合監視として閲覧可 |
| **個別被害報告・救助要請** | 自己投稿以外の詳細・連絡先・救助出動は**非公開・制限**（投稿は常に `unverified`） | 詳細閲覧・救助出動ルートは不可 | **全件閲覧・真偽昇格 (`verified` / `official`)・救助ルート試算・全明細CSV/Excel出力可** |
| **企業BCP拠点・機密台帳** | **API / AIエージェント / Firestore すべて完全遮断** | **自社拠点のみFirestore隔離管理**・即時診断・BCP安全立地比較可（他社不可視） | 企業側が「災害時のみ政府共有 (`gov_emergency_share`)」を許可した拠点のみ閲覧可 |
| **Firestore リアルタイム掲示板** | 公開チャンネル（`public`）＋ `@もちまも` 避難案内 | 公開 ＋ **行政⇄企業 1:1 緊急連携** (`enterprise_liaison`) | 全チャンネル統括（公開・各社連携・**政府対策本部専用** `government`） |

> [!NOTE]
> **政府関連機関の登録認証コードについて（審査・試用向け案内）**:
> 一般利用者による権限昇格（市民アカウントが勝手に政府区分へ登録し他者の救助要請詳細等を閲覧すること）を防ぐゼロトラスト設計のため、**機関認証コードはWeb画面上や公開リポジトリには掲載していません**。審査・評価時に政府関連機関ロールをお試しいただく際は、**別途Googleドライブで共有しているご利用ガイドPDFに記載の審査用認証コード**をご入力ください。

---

## 4. Google AI アーキテクチャ（22 Function Calling × Grounding × Live2D）

1. **Gemini Interactions API & SSE ストリーミング（[ai_assistant.py](backend/app/ai_assistant.py)）**:
   - 自然言語の防災質問に対し、ロール権限でフィルタリングされた **22種の Function Calling ツール** を自律選択・連続実行します（建物詳細、250mメッシュ統計、区比較、優先確認エリア、R8未掲載優先度、歴史的建物×住宅 P1〜P4優先度、京都市11地震帯影響、企業自社拠点リスク、企業BCP安全立地比較、最適避難所自動選定、避難ルート探索、自律地図操作 `operate_map_interface`、CSV/Excelエクスポート準備 `prepare_disaster_export` 等）。
   - ログインアカウント（UID）・区分別の会話スレッド自動保存および継続対話に対応しています。
2. **決定論的 Grounding 検証 & 安全ガード（[grounding.py](backend/app/grounding.py), [security.py](backend/app/security.py)）**:
   - AI回答に含まれる数値・割合・メッシュコード・建物ID・報告ID・URLを実際のツール返却値と自動照合し、チャットUIに検証バッジを表示します。
   - AIが `unverified`（未確認の市民報告）または訓練用サンプルを参照した場合は、確定事実と混同しないよう自動警告バッジを付与します。
   - 市民からの他社機密・BCP照会など権限外のリクエストは、LLM実行前およびツール実行層の両方で即時ブロックします。
3. **もちまも Live2D ＆ Gemini TTS 音声解説（[tts.py](backend/app/tts.py), [MochimamoLive2D.tsx](frontend/src/components/MochimamoLive2D.tsx)）**:
   - **Gemini TTS（`gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts`、音声 `Leda` 等）** によるリアルタイム日本語音声合成と、60Hz音声振幅に応じた15パーツ Live2D ボーンリグのリップシンク・表情連動（`idle` / `listening` / `thinking` / `speaking` / `happy` / `alert`）を搭載。
4. **Cloud Firestore 3チャンネル掲示板 `@もちまも` Agent（[BoardChatPanel.tsx](frontend/src/components/BoardChatPanel.tsx), [firestore.rules](firestore.rules)）**:
   - 掲示板スレッドで `@もちまも` とメンションすると、会話履歴から現在地・対象者や周辺の `road_blocked`（通行止め）状況を解析し、`/api/board-chat/agent` が避難・支援提案とワンクリック「地図にルート・ピンを表示」アクションを自動生成・永続化します。

---

## 5. システム構成

```text
.
├── start.sh                                  # Backend (:8000) + Frontend (:3000) 一括起動スクリプト
├── .env.example                              # 環境変数テンプレート（Geminiキー・公開保護・Firebase設定）
├── firebase.json                             # Firebase / Firestore / Auth構成
├── firestore.rules                           # ロール別・テナント隔離・掲示板3チャンネル強制セキュリティルール
├── firestore.indexes.json                    # Firestore 複合インデックス定義
├── backend/
│   ├── app/
│   │   ├── main.py                           # FastAPI アプリ・CORS・全APIエンドポイント
│   │   ├── auth.py                           # Firebase ID Token署名検証・ロール別RBAC・機関認証コード保護
│   │   ├── firebase_backend.py               # Firebase Admin SDK（Custom Claims同期・Firestore永続化/Fallback）
│   │   ├── ai_assistant.py                   # Gemini Interactions API / SSE / 22 Function Calling / 自律地図操作
│   │   ├── grounding.py                      # 数値・ID・URL自動照合＆未確認/サンプルソース検知
│   │   ├── tts.py                            # Gemini TTS（response_modalities=['AUDIO']）音声合成ヘルパー
│   │   ├── data_store.py                     # Parquet/GeoJSON空間データ読込・フィルタ集計
│   │   ├── mvt.py                            # 全513,815棟 Mapbox Vector Tiles (MVT v2.1) エンコーダ
│   │   ├── bcp_site.py                       # 企業BCP安全立地一次スクリーニング・自社拠点即時診断
│   │   ├── seismic_belts.py                  # 京都市11地震シナリオ・活断層・液状化傾向関係分析
│   │   ├── heritage_residential.py           # 1950年以前歴史的建物 × 住宅系 P1〜P4 対策優先度＆解決策
│   │   ├── r8_seismic.py                     # 京都市 R8市有建築物耐震性能リスト連携・未掲載優先判定
│   │   ├── shelter_rec.py                    # 514指定緊急避難場所連携・発災時最適避難所自動選定
│   │   ├── route_sim.py                      # 京都市実道路ネットワーク（OSM）A*回避経路シミュレーション（訓練用）
│   │   ├── board_store.py                    # 災害用伝言板ストア（電話番号正規化・マスキング・暗証番号管理）
│   │   ├── reports_store.py                  # 被害状況報告ストア（未確認強制・同意検証・重複検知）
│   │   ├── disaster_updates.py               # 気象庁 / 京都市防災ポータル更新取得・アーカイブ
│   │   ├── export_utils.py                   # UTF-8 BOM付 CSV & マルチシート Excel (.xlsx) 出力エンジン
│   │   ├── geocoding.py                      # 京都市地名・住所・施設名・避難所検索 & 逆ジオコーディング
│   │   ├── security.py                       # レート制限・日次上限・BYOK制御・入力サニタイズ・秘密マスク
│   │   └── constants.py                      # 行政区中心座標・J-SHIS階級定義・京都市公的耐震支援制度
│   ├── scripts/
│   │   └── fetch_and_build.py                # PLATEAU + J-SHIS データ取得・EPSG:6674空間結合パイプライン
│   ├── data/processed/                       # 前処理済空間データ（buildings.parquet, meshes.geojson, kyoto_roads.json.gz 等）
│   └── tests/                                # 6テストスイート（計42件：RBAC・AIセキュリティ・Firestore・防災API等）
└── frontend/
    └── src/
        ├── app/
        │   ├── page.tsx                      # Map-First 統合防災プラットフォーム（認証ガード・全画面地図・切替ドロワー）
        │   ├── login/page.tsx                # 3区分認証ゲート（メール / Googleログイン / ガイド・新規登録ショートカット）
        │   ├── register/page.tsx             # 3区分新規登録（一般市民・企業・要認証コード政府機関、メール / Google対応）
        │   ├── guide/page.tsx                # ご利用ガイド（登録手順・権限比較表・ワンクリックコピーAI活用例）
        │   ├── board/page.tsx                # 災害用伝言板 スタンドアロンUI (/board)
        │   └── api/                          # FastAPI / SSE ストリーミングプロキシ
        ├── contexts/AuthContext.tsx          # Firebase Auth + Custom Claims + バックエンドRBAC同期コンテキスト
        └── components/                       # QuakeMap, FloatingHeader, AiAssistantPanel, MochimamoLive2D,
                                              # BoardChatPanel, EnterpriseAssetsPanel, RiskStatsDrawer,
                                              # DamageReportPanel, DisasterBoard, ShelterRecommendPanel, NavigationPanel 他
```

---

## 6. セットアップ・起動・テスト方法（Mac / Linux）

前処理済みの京都市空間データ（`backend/data/processed/`）を同梱しているため、ローカル環境ですぐに全機能を起動・検証できます。

### 必要環境
- Python 3.12+ & `uv`
- Node.js 20+ & `npm`
- Firebase プロジェクト（Firebase Authentication［メール・Google有効］＋ Cloud Firestore）
- Gemini API キー（`.env` に `GEMINI_API_KEY` を設定、またはブラウザUIから個人キー持込 BYOK も可）

### 1) 環境変数の設定

```bash
# ルート側（Backend / Gemini / Firebase検証 / 政府機関コード）
cp .env.example .env
# .env に GEMINI_API_KEY / FIREBASE_PROJECT_ID / GOV_REGISTRATION_CODE を設定

# フロントエンド側（Firebase Web SDK構成）
cp frontend/.env.local.example frontend/.env.local
# frontend/.env.local に NEXT_PUBLIC_FIREBASE_* を設定
```

### 2) 一括起動（推奨）

```bash
./start.sh
```

起動後、ブラウザで **`http://localhost:3000`** を開きます（`Ctrl + C` で停止）。
- Webアプリ画面: `http://localhost:3000`（`/login`・`/register`・`/guide`・`/`・`/board`）
- APIドキュメント（Swagger）: `http://127.0.0.1:8000/docs`

### 3) テスト・静的解析

```bash
# バックエンド単体・結合テスト（RBAC・AIセキュリティ・Firestore・空間データ・API 全42件）
cd backend
uv run pytest -v

# フロントエンド TypeScript型チェック・ESLint・本番ビルド確認
cd ../frontend
npx tsc --noEmit && npm run lint && npm run build
```

---

## 7. 公開運用時のAPI保護・費用制御設定（`.env`）

| 環境変数 | デフォルト値 | 役割 |
|---|---|---|
| `GEMINI_API_KEY` | 未設定 | サーバー側の共用 Gemini API キー（`.gitignore` 対象） |
| `AI_PUBLIC_SERVER_KEY_ENABLED` | `true` | `false` にすると共用キーを無効化し、個人キー持込（BYOK）のみで稼働 |
| `AI_ACCESS_CODE` | 空（無効） | 設定時、共用キー利用に `X-Ai-Access-Code` 一致を必須化 |
| `AI_ALLOW_PREMIUM_MODELS` | `false` | `false` の場合、共用キーでは `gemini-3.5-flash-lite` のみ許可 |
| `AI_RATE_LIMIT_PER_MIN` / `PER_HOUR` | `8` / `40` | 共用キー利用時の IP あたりリクエスト上限 |
| `AI_DAILY_BUDGET_REQUESTS` | `300` | 共用キー利用時のサーバー全体 1日合計リクエスト上限 |
| `GOV_REGISTRATION_CODE` | 未設定 | 政府関連機関アカウント新規登録時のサーバー側必須照合コード |
| `CORS_ALLOW_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 許可するフロントエンドオリジン（ワイルドカード `*` 禁止） |

---

## 8. 使用データセット・API・ライセンス一覧

| データ種別 | 名称・API | 提供元 | 基準年・バージョン | ライセンス / 利用条件 | 出典URL |
|---|---|---|---|---|---|
| 建物データ | Project PLATEAU 3D都市モデル（京都市） | 国土交通省・京都市 | 2025年度（2026年5月更新・第5.0版） | PLATEAU Site Policy「3. 著作権について」（出典明記で無償利用可） | https://www.geospatial.jp/ckan/dataset/plateau-26100-kyoto-shi-2025 |
| 地震ハザード | J-SHIS Web API（確率論的地震動予測地図 250mメッシュ） | 防災科学技術研究所（NIED） | 2024年版（`Y2024` / 平均ケース `AVR` / 全地震 `TTL_MTTL`） | J-SHIS 利用規約（加工・頒布可・出典明記必須） | https://www.j-shis.bosai.go.jp/api-list |
| 表層地盤 | J-SHIS Web API（表層地盤情報 250mメッシュ） | 防災科学技術研究所（NIED） | `V4`（微地形区分・ARV・AVS） | 同上 | https://www.j-shis.bosai.go.jp/api-sstruct-meshinfo |
| 避難・耐震・地震帯 | 京都市 指定緊急避難場所・R8市有建築物耐震性能リスト・11地震シナリオ | 国土地理院・京都市 | 令和8年版等 | 各自治体・機関利用規約（出典明記） | https://www.city.kyoto.lg.jp/tokei/page/0000128082.html |
| 地震履歴 | 気象庁 地震情報 JSON / Yahoo!災害履歴 | 気象庁（JMA）ほか | リアルタイム・直近履歴 | 気象庁ホームページ利用規約（出典明記） | https://www.jma.go.jp/bosai/quake/data/list.json |
| 背景地図 | 地理院タイル（淡色地図） | 国土地理院（GSI） | 最新 | 国土地理院コンテンツ利用規約（出典明記） | https://maps.gsi.go.jp/development/ichiran.html |
| 道路網 | OpenStreetMap (Overpass API) | © OpenStreetMap contributors | 最新（京都市域前処理済） | ODbL（出典明記・訓練用経路シミュレーションに利用） | https://www.openstreetmap.org/copyright |
