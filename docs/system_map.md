# CareerLink CRM システムマップ

## 概要

CareerLink HR Frontend は Ruby on Rails 5.1 ベースの HR/CRM システム。企業・担当者・求人・応募・連絡履歴を管理する。

- リポジトリ: `/Users/cl/Desktop/AI-Sales/careerlink.21/hr_frontend/`
- フレームワーク: Rails 5.1.6.2
- データベース: MySQL 5.7+
- 検索: Elasticsearch
- バックグラウンドジョブ: Sidekiq

---

## 1. 認証方式

### 1.1 認証メカニズム

**方式**: HTTPヘッダーベースのセッショントークン認証

| 項目 | 値 |
|------|-----|
| ヘッダー名 | `X-Cl-Session-Admin` |
| フォーマット | Base64エンコードされたJSON |
| 有効期限 | 外部認証システムで管理（本アプリ内では検証のみ） |
| フォールバック | 環境変数 `X_CL_SESSION_ADMIN`（サーバー間通信用） |

### 1.2 トークン構造

```json
{
  "id": 1,
  "email": "admin@example.com",
  "status": "active",
  "full_name": "山田 太郎",
  "is_sale": true,
  "is_enabled": true,
  "is_locked": false,
  "privileges": {
    "EXECUTIVE_SEARCH": ["JP_SALES", "JP_ATS"]
  }
}
```

### 1.3 認証フロー

```
1. クライアント → X-Cl-Session-Admin ヘッダー付きリクエスト
2. サーバー → Base64デコード → JSON解析 → CareerLinkAdmin オブジェクト生成
3. validate_admin で検証
   - 成功: リクエスト処理続行
   - 失敗: 401 Unauthorized または ログインページへリダイレクト
```

### 1.4 根拠

| ファイル | 行 | 内容 |
|----------|-----|------|
| `app/helpers/application_helper.rb` | 70-90 | `current_admin` メソッド - ヘッダーからトークン取得・デコード |
| `app/controllers/application_controller.rb` | 9 | `before_action :validate_admin` |
| `app/models/career_link_admin.rb` | 1-41 | CareerLinkAdmin クラス定義 |

### 1.5 ロールベースアクセス制御

| ロール | 権限キー | 用途 |
|--------|----------|------|
| 営業管理者 | `EXECUTIVE_SEARCH:JP_SALES` | 企業・連絡履歴の管理 |
| ATS管理者 | `EXECUTIVE_SEARCH:JP_ATS` | 求人・応募・面接の管理 |

**根拠**: `app/helpers/application_helper.rb:93-120` - `sales_admin?`, `ats_admin?` メソッド

---

## 2. HTTP API エンドポイント

### 2.1 企業関連

| メソッド | パス | 用途 | レスポンス形式 |
|----------|------|------|----------------|
| GET | `/companies` | 企業一覧（ページング・検索対応） | HTML |
| GET | `/companies/:id` | 企業詳細 | **JSON** (Accept: application/json) |
| POST | `/companies` | 企業作成 | JSON |
| PUT | `/companies/:id` | 企業更新 | JSON |
| DELETE | `/companies/:id` | 企業削除 | JSON |
| GET | `/companies/tags` | タグで企業フィルター | **HTML only** (JSON不可) |

**根拠**: `config/routes.rb:20-35`

**注意**:
- `/companies/tags`はHTMLのみ返し、Accept: application/jsonは406 Not Acceptableになる
- `/companies/:id`はJSONで企業詳細を取得可能
- **重要** (2026-01-27発見): JSON APIは担当者メールアドレスを含まない。HTMLページには表示されるため、CrmClientは両方から情報を取得する

### 2.2 タグ関連

| メソッド | パス | 用途 | コントローラー |
|----------|------|------|----------------|
| GET | `/tags` | 全タグ一覧取得 | `tags#index` |

**レスポンス例**:
```json
["南部・3月連絡", "中部・製造業", "北部・IT"]
```

**根拠**: `app/controllers/tags_controller.rb:1-6`

### 2.3 連絡履歴（Sales Actions）

| メソッド | パス | 用途 | コントローラー |
|----------|------|------|----------------|
| POST | `/companies/:company_id/sales_actions` | 連絡履歴作成 | `sales/actions#create` |
| PUT | `/companies/:company_id/sales_actions/:id` | 連絡履歴更新 | `sales/actions#update` |
| DELETE | `/companies/:company_id/sales_actions/:id` | 連絡履歴削除 | `sales/actions#destroy` |

**アクションタイプ**:
- `sales_tel_action` - 電話
- `sales_visit_action` - 訪問
- `sales_contract_action` - 契約
- `sales_others_action` - その他

**根拠**: `app/controllers/sales/actions_controller.rb:1-125`

### 2.4 タイムライン

| メソッド | パス | 用途 |
|----------|------|------|
| GET | `/timeline` | 全アクティビティ |
| GET | `/timeline/companies/:company_id` | 企業別アクティビティ |
| GET | `/timeline/agents/:agent_id` | 担当者別アクティビティ |

**根拠**: `config/routes.rb:75-78`

**注意** (2026-01-27確認): タイムラインエンドポイントは現在**HTTP 500エラー**を返す場合があります。CrmClientでは連絡履歴取得に失敗した場合、空の履歴で続行するよう実装されています。

### 2.5 ヘルスチェック

| メソッド | パス | 用途 |
|----------|------|------|
| GET | `/health` | サーバー状態確認（認証不要） |

**根拠**: `app/controllers/health_controller.rb:1-17`

---

## 3. cURL リクエスト例

### 3.1 認証トークン生成

```bash
# トークン生成（実際は外部認証システムから取得）
TOKEN=$(echo '{"id":1,"email":"user@example.com","privileges":{"EXECUTIVE_SEARCH":["JP_SALES"]}}' | base64)
```

### 3.2 企業一覧取得

```bash
curl -X GET "http://localhost:3000/companies?page=1" \
  -H "X-Cl-Session-Admin: ${TOKEN}" \
  -H "Accept: application/json"
```

### 3.3 タグで企業検索

```bash
curl -X GET "http://localhost:3000/companies/tags?tag=南部・3月連絡" \
  -H "X-Cl-Session-Admin: ${TOKEN}" \
  -H "Accept: application/json"
```

### 3.4 企業詳細取得

```bash
curl -X GET "http://localhost:3000/companies/123" \
  -H "X-Cl-Session-Admin: ${TOKEN}" \
  -H "Accept: application/json"
```

### 3.5 連絡履歴作成（電話）

```bash
curl -X POST "http://localhost:3000/companies/123/sales_actions" \
  -H "X-Cl-Session-Admin: ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sales_tel_action": {
      "performed_at": 1706284800,
      "staff_name": "田中さん",
      "place": "本社",
      "log": "3月の求人について打ち合わせ"
    }
  }'
```

### 3.6 全タグ取得

```bash
curl -X GET "http://localhost:3000/tags" \
  -H "X-Cl-Session-Admin: ${TOKEN}" \
  -H "Accept: application/json"
```

---

## 4. データモデル

### 4.1 Company（企業）

**テーブル**: `companies`

| フィールド | 型 | 説明 |
|------------|-----|------|
| id | INTEGER | 主キー |
| name_en | STRING | 英語名（国内ユニーク） |
| name_ja | STRING | 日本語名 |
| name_local | STRING | 現地語名 |
| name_kana | STRING | カナ |
| tax_code | STRING | 税番号 |
| profile | TEXT | 企業概要 |
| size | STRING | 企業規模 |
| url | STRING | Webサイト |
| country_id | INTEGER | 国 |
| province_id | INTEGER | 都道府県/省 |
| district_id | INTEGER | 区/地区 |
| address | STRING | 住所 |
| phone | STRING | 電話番号 |
| contact_email | STRING | 連絡先メール |
| contact_person | STRING | 担当者名 |
| tags_snapshot | TEXT | タグ（非正規化、カンマ区切り） |
| agent_created_by_id | INTEGER | 作成者 |
| agent_last_updated_by_id | INTEGER | 最終更新者 |
| created_at | DATETIME | 作成日時 |
| updated_at | DATETIME | 更新日時 |

**リレーション**:
- `has_many :offices` - オフィス
- `has_many :staffs` - 担当者
- `has_many :sales_actions` - 連絡履歴
- `has_many :jobs` - 求人

**根拠**: `app/models/company.rb:1-327`, `db/schema.rb`

### 4.2 Office（オフィス）

**テーブル**: `offices`

| フィールド | 型 | 説明 |
|------------|-----|------|
| id | INTEGER | 主キー |
| company_id | INTEGER | 企業ID |
| name | STRING | オフィス名 |
| address | STRING | 住所 |
| province_id | INTEGER | 都道府県/省 |
| phone | STRING | 電話番号 |
| contact_email | STRING | 連絡先メール |
| contact_person | STRING | 担当者名 |

**根拠**: `app/models/office.rb:1-173`

### 4.3 Staff（担当者）

**テーブル**: `staffs`

| フィールド | 型 | 説明 |
|------------|-----|------|
| id | INTEGER | 主キー |
| company_id | INTEGER | 企業ID |
| office_id | INTEGER | オフィスID |
| name | STRING | 氏名 |
| email | STRING | メールアドレス |
| phone | STRING | 電話番号 |
| department | STRING | 部署 |
| note | TEXT | メモ |
| from_year_month | STRING | 開始年月（YYYY/MM） |
| to_year_month | STRING | 終了年月（YYYY/MM） |

**根拠**: `app/models/staff.rb:1-122`

### 4.4 SalesAction（連絡履歴）

**テーブル**: `sales_actions`

| フィールド | 型 | 説明 |
|------------|-----|------|
| id | INTEGER | 主キー |
| company_id | INTEGER | 企業ID |
| office_id | INTEGER | オフィスID |
| agent_id | INTEGER | 担当エージェントID |
| staff_id | INTEGER | 相手担当者ID |
| type | STRING | 種別（TelAction/VisitAction/ContractAction/OthersAction） |
| log | TEXT | 連絡内容 |
| performed_at | DATETIME | 実施日時 |
| place | STRING | 場所 |
| created_at | DATETIME | 作成日時 |
| updated_at | DATETIME | 更新日時 |

**種別**:
- `Sales::TelAction` - 電話
- `Sales::VisitAction` - 訪問
- `Sales::ContractAction` - 契約
- `Sales::OthersAction` - その他

**根拠**: `app/models/sales/` ディレクトリ, `db/schema.rb`

### 4.5 Tag（タグ）

**テーブル**: `tags`, `taggings`

| フィールド (tags) | 型 | 説明 |
|-------------------|-----|------|
| id | INTEGER | 主キー |
| name | STRING | タグ名（ユニーク） |
| taggings_count | INTEGER | 使用回数 |

| フィールド (taggings) | 型 | 説明 |
|-----------------------|-----|------|
| id | INTEGER | 主キー |
| tag_id | INTEGER | タグID |
| taggable_id | INTEGER | 対象ID |
| taggable_type | STRING | 対象種別（Company/Job/Applicant） |
| context | STRING | コンテキスト（サイト別） |
| created_at | DATETIME | 作成日時 |

**タグ付け方式**: `acts-as-taggable-on` gem を使用

**根拠**: `app/models/tag.rb:1-13`, `Gemfile` (acts-as-taggable-on)

---

## 5. 企業検索機能

### 5.1 タグによる検索

**エンドポイント**: `GET /companies/tags`

**パラメータ**:
- `tag` - タグ名（例: "南部・3月連絡"）

**実装箇所**: `app/controllers/companies_controller.rb` - `tags` アクション

**内部処理**:
1. `Company.tagged_with(tag)` で acts-as-taggable-on のクエリ実行
2. ページング処理
3. JSON または HTML で返却

### 5.2 Elasticsearch による検索

**検索クラス**: `Search::CompanyRepository`

**検索対象フィールド**:
- `name_en`, `name_ja`, `name_local`, `name_kana`
- `profile`
- `tags_snapshot`

**根拠**: `app/models/company.rb` の Elasticsearch 設定

### 5.3 地域による検索

**エンドポイント**: `GET /companies/:company_id/provinces`

**フィルタリング**: `province_id`, `country_id` で絞り込み可能

---

## 6. 連絡履歴の取得

### 6.1 企業タイムライン

**エンドポイント**: `GET /timeline/companies/:company_id`

**取得内容**:
- SalesAction（電話・訪問・契約）
- 求人の作成・更新
- 応募の進捗
- PaperTrail による変更履歴

### 6.2 連絡履歴の粒度

| 項目 | 取得可能 |
|------|----------|
| 日時 | `performed_at` |
| 種別 | `type`（電話/訪問/契約/その他） |
| 内容 | `log` |
| 担当者 | `agent_id` → Agent |
| 相手 | `staff_id` → Staff |
| 場所 | `place` |

**根拠**: `app/models/sales/tel_action.rb`, `visit_action.rb`, etc.

---

## 7. 認証フロー詳細（P0調査結果）

### 7.1 外部認証サービス

**重要発見**: hr_frontend にはログインエンドポイントが存在しない。認証は外部サービスで処理される。

| 項目 | 値 |
|------|-----|
| 外部ログインURL | `/siankaan042{offset}/login?target_path={path}` |
| offset計算 | JP=1, VN=2, KYUJIN=3, KH=4, TH=5, ID=6, PH=7, SG=8 |
| 認証処理 | 外部 CareerLink 認証サービス（careerlink.rb gem） |
| トークン形式 | Base64(JSON) を `X-Cl-Session-Admin` ヘッダーで渡す |

**根拠**:
- `app/helpers/application_helper.rb:31-34` - `s2_admin_root` メソッド
- `app/controllers/application_controller.rb:15-26` - リダイレクト処理
- `.gitmodules:1-3` - careerlink.rb サブモジュール（外部gem）

### 7.2 認証フロー

```
1. クライアント → hr_frontend にリクエスト（トークンなし）
2. hr_frontend → 401 または /siankaan042{offset}/login へリダイレクト
3. ユーザー → 外部認証サービスでログイン
4. 外部認証サービス → X-Cl-Session-Admin トークン発行
5. クライアント → トークン付きでhr_frontendにリクエスト
```

### 7.3 トークン有効期限

- **確定**: トークン内に有効期限フィールドは含まれない（調査済み）
- **挙動**: 外部認証サービス側でセッション管理
- **検知方法**: 401/403 レスポンスで失効を検知
- **対応方針**: 401検知時に1回のみ再認証試行、失敗なら `AuthError`

### 7.4 プログラマティックログイン

**現状**: hr_frontend には ID/PASS でトークンを取得する API がない

**対応方針**:
1. `CRM_SESSION_TOKEN` 環境変数があればそれを使用（推奨）
2. なければ外部認証サービスへのログインを試行

### 7.5 外部認証サービス詳細（2026-01-27 調査確定）

**重要**: ログインエンドポイントは `/siankaan0421`（JP offset）を使用する。

**ログインフロー**:

```
1. GET  /siankaan0421/login          → ログインフォーム表示 + CSRFトークン取得
2. POST /siankaan0421/login_check    → フォーム送信
   Content-Type: application/x-www-form-urlencoded
   Body:
     - _username=<email>
     - _password=<password>
     - authenticity_token=<CSRFトークン>  ← 必須！
     - target_path=（空でOK）
3. 成功時: /siankaan0421 へリダイレクト（302）、セッションCookie設定
   失敗時: /siankaan0421/login へリダイレクト
```

**セッションCookie**:
- `C24ADMINSESSID`: メインセッションID
- `_c24_session`: セッションデータ（暗号化）

**重要な発見**:
- `/siankaan0422` は VN サイト用だが、認証は `/siankaan0421`（JP）を使用
- `authenticity_token`（CSRFトークン）が必須
- CSRFトークンはログインページのhiddenフィールドから取得
- ログイン成功後はCookieベースのセッション認証

**エラーメッセージ**:
- 認証失敗: 「Eメール（会員ID）、またはパスワードが違います。」
- CSRFなし: HTTP 422（システムエラー）

### 7.6 タグ一覧取得

**エンドポイント**: `GET /executive-search/vn/tags`

**認証**: セッションCookie必須

**レスポンス例**:
```json
["日系企業","IT企業","南部・1月連絡","南部・2月連絡","北部・1月連絡",...]
```

**月別連絡タグの形式**:
- `南部・1月連絡` 〜 `南部・12月連絡`
- `北部・1月連絡` 〜 `北部・12月連絡`
- `中部・1月連絡` 〜 `中部・12月連絡`

### 7.7 セッショントークン取得方法（手動）

ブラウザでログイン後、DevTools で取得:

```
1. https://www.careerlink.vn:1443/siankaan0421/login にアクセス
2. 認証情報でログイン
3. DevTools > Network > 任意のAPIリクエスト
4. Request Headers から X-Cl-Session-Admin の値をコピー
5. .env の CRM_SESSION_TOKEN に設定
```

---

## 8. ページング仕様（P0調査結果・確定）

### 8.1 基本仕様

| 項目 | 値 | 根拠 |
|------|-----|------|
| ページングライブラリ | **カスタム実装**（will_paginate/kaminari 未使用） | Gemfile 調査 |
| 検索バックエンド | Elasticsearch | `app/models/company.rb:104-178` |
| ページパラメータ | `page` (1-indexed) | `companies_controller.rb:10,22` |
| デフォルトページ | 1 | `companies_controller.rb:11,23` |
| ページサイズ | **10件** | `companies_controller.rb:10,22,55` |
| オフセット計算 | `(page - 1) * size` | `search/company_repository.rb:110-196` |

### 8.2 タグ検索のページング

**エンドポイント**: `GET /companies/tags`

**重要**: このエンドポイントは**HTMLを返す**（JSONではない）。Accept: application/jsonは406 Not Acceptableになる。

**パラメータ**:
| パラメータ | 型 | 説明 |
|------------|-----|------|
| `tags` | string | タグ名（パイプ `\|` またはカンマ `,` 区切りで複数指定可） |
| `tag_query_type` | string | `or` または `and`（デフォルト: `and`） |
| `page` | integer | ページ番号（デフォルト: 1） |

**レスポンス形式**:
- HTML形式。企業データはHTMLテーブル内に含まれる
- CrmClientではHTMLをパースして企業ID・名前を抽出

**HTMLからのデータ抽出**:
```typescript
// 正規表現で企業リンクを抽出
/<a[^>]*href="\/executive-search\/vn\/companies\/(\d+)"[^>]*>([^<]+)<\/a>/g
```

**根拠**: `app/controllers/companies_controller.rb:19-41`

### 8.3 全件取得のための計算

```
総ページ数 = ceil(total_count / page_size)
全件取得 = page=1 から page=総ページ数 まで順次取得
```

### 8.4 cURL 例（ページング付き）

```bash
# 1ページ目
curl "http://localhost:3000/companies/tags?tags=南部・3月連絡&page=1" \
  -H "X-Cl-Session-Admin: ${TOKEN}"

# 2ページ目
curl "http://localhost:3000/companies/tags?tags=南部・3月連絡&page=2" \
  -H "X-Cl-Session-Admin: ${TOKEN}"
```

---

## 9. 未確定事項（残り）

### 9.1 タグ検索の完全一致/部分一致

- **推測**: Elasticsearch の tags_snapshot フィールドで検索
- **対応**: 完全一致として実装、必要に応じて調整

### 9.2 レート制限

- **未確定**: API のレート制限の有無
- **対応**: 指数バックオフでリトライ、無限リトライは禁止

### 9.3 外部認証サービスの詳細

- **未確定**: 外部認証サービスの正確なエンドポイントとリクエスト形式
- **対応**: 実環境で疎通テストを行い確定

---

## 10. 図: システム構成

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI-Sales コネクタ                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ CrmClient    │  │ TagNormalizer│  │ CLI          │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
          │                                      │
          │ (1) ID/PASS ログイン                 │ (2) API呼び出し
          ▼                                      ▼
┌──────────────────┐              ┌─────────────────────────────┐
│ 外部認証サービス  │              │    HR Frontend (Rails)      │
│ /siankaan042X/   │──トークン──▶│  X-Cl-Session-Admin ヘッダー │
│ login            │              │                             │
└──────────────────┘              │  Companies / Tags / Timeline│
                                  └─────────────────────────────┘
                                              │
                                              ▼
                                  ┌──────────────┐  ┌──────────────┐
                                  │ MySQL        │  │ Elasticsearch│
                                  └──────────────┘  └──────────────┘
```

---

## 11. コネクタ実装方針（P0更新）

### 11.1 認証（優先順位）

```typescript
// 1. CRM_SESSION_TOKEN があればそれを使用（既存互換）
// 2. なければ CRM_LOGIN_EMAIL / CRM_LOGIN_PASSWORD で外部認証
// 3. 401検知時は1回のみ再認証試行
```

### 11.2 ページング対応

```typescript
// searchCompaniesByRawTag は全件取得モードをサポート
// 内部でページングして全件収集
async searchCompaniesByRawTag(rawTag: string, fetchAll: boolean = true): Promise<CompanyStub[]>
```

### 11.3 エラーハンドリング

| HTTPステータス | 意味 | 対応 |
|----------------|------|------|
| 401 | 認証エラー | 1回再認証試行 → 失敗なら `AuthError` |
| 422 | バリデーションエラー | `ValidationError` スロー |
| 429 | レート制限 | 指数バックオフでリトライ |
| 5xx | サーバーエラー | リトライ（最大3回） |

### 11.4 データマッピング

CRM の Company → コネクタの CompanyDetail:
- `id` → `companyId`
- `name_ja` / `name_en` → `name`
- `profile` → `description`
- `province_id` → 地域名に変換
- `tags_snapshot` → `tags[]`
- `sales_actions` → `contactHistory[]`

---

## 12. P1 実装: 一気通貫パイプライン

### 12.1 パイプライン概要

```
タグ検索 → 会社選択 → 詳細取得 → プロファイル構築 → 候補者検索 → メール作成 → Gmail下書き
```

### 12.2 コンポーネント構成

| コンポーネント | ファイル | 役割 |
|----------------|----------|------|
| TagNormalizer | `src/domain/TagNormalizer.ts` | タグ解析（地域・月・年） |
| CrmClient | `src/connectors/crm/CrmClient.ts` | CRM API 呼び出し |
| CompanyProfileBuilder | `src/domain/CompanyProfileBuilder.ts` | 事実/仮説分離プロファイル |
| CandidateClient | `src/connectors/candidate/CandidateClient.ts` | 候補者検索（現在スタブ） |
| EmailComposer | `src/domain/EmailComposer.ts` | 日本語メールテンプレート |
| GmailClient | `src/connectors/gmail/GmailClient.ts` | Gmail下書き作成（送信なし） |

### 12.3 CompanyProfile 構造（事実/仮説分離）

```typescript
interface CompanyProfile {
  facts: {
    companyId: string;
    companyName: string;
    location: { region, province, address };
    industryText: string;
    tags: string[];
    contactHistoryExcerpt: {
      lastContactDate, lastContactType,
      recentTopics[], totalContacts
    };
  };
  summaries: {
    industrySummary, pastContactsSummary
  };
  assumptions: string[];  // 現在は空（将来のLLM用）
  sourceRefs: { companyId, timelineItemIds[] };
}
```

### 12.4 メールテンプレート

- **件名**: `【CareerLink】{{companyName}}様へ人材のご提案`
- **宛先**: `{{companyName}} ご担当者様`
- **本文構成**:
  1. 挨拶
  2. 連絡コンテキスト（初回/最近/久しぶり）
  3. 候補者リスト（PII無し: ヘッドライン/スキル/勤務地/入社可能日/推薦理由）
  4. クロージング
  5. 署名

### 12.5 セキュリティ設計

| 対策 | 実装 |
|------|------|
| 送信禁止 | GmailClient に send() メソッドなし |
| PII マスク | CrmClient 内で email/phone をマスク |
| 候補者名非表示 | EmailComposer で headline のみ使用 |
| 認証情報保護 | .env から読み込み、ログ出力禁止 |

### 12.6 CLI 実行例

```bash
# 基本実行（Gmail スタブモード）
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡"

# 特定会社を指定
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --company-id 123

# ドライラン（メール内容確認のみ）
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --dry-run
```

---

## 更新履歴

| 日付 | 更新内容 |
|------|----------|
| 2026-01-26 | 初版作成 |
| 2026-01-26 | P0調査: 認証フロー詳細、ページング仕様を確定 |
| 2026-01-26 | P1実装: 一気通貫パイプライン追加 |
