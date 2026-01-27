# AI-Sales Runbook

## 概要

このドキュメントは AI-Sales CRM コネクタの実行手順とトラブルシューティングガイドです。

---

## 1. 環境変数の設定

### 1.1 必要な環境変数

`.env` ファイルに以下を設定してください（値は各自の環境に合わせて）：

```bash
# CRM API Configuration
CRM_BASE_URL=<CRM APIのベースURL>

# Authentication Option 1: Session Token (推奨)
CRM_SESSION_TOKEN=<Base64エンコードされたセッショントークン>

# Authentication Option 2: Credentials
CRM_LOGIN_EMAIL=<ログインメールアドレス>
CRM_LOGIN_PASSWORD=<パスワード>

# Optional: Auth host if different from base URL
# CRM_AUTH_HOST=<認証サービスのURL>

# Gmail API Configuration (for draft creation)
GMAIL_CLIENT_ID=<OAuth2 Client ID>
GMAIL_CLIENT_SECRET=<OAuth2 Client Secret>
GMAIL_REFRESH_TOKEN=<OAuth2 Refresh Token>

# Candidate API Configuration
CANDIDATE_MODE=stub                # 'stub' or 'real' (default: stub)
CANDIDATE_API_URL=                 # Required for real mode
CANDIDATE_API_KEY=                 # Required for real mode

# Approval Token Configuration
APPROVAL_TOKEN_SECRET=<HMAC秘密鍵>  # 本番環境では必須

# Auto-Send Configuration (P4-1)
ENABLE_AUTO_SEND=false             # 'true' で送信有効（デフォルト: false）
KILL_SWITCH=false                  # 'true' で緊急停止（デフォルト: false）
SEND_ALLOWLIST_DOMAINS=            # 許可ドメイン（カンマ区切り、例: "example.com,test.co.jp"）
SEND_ALLOWLIST_EMAILS=             # 許可メール（カンマ区切り、例: "a@x.com,b@y.com"）
SEND_MAX_PER_DAY=20                # 日次最大送信数（デフォルト: 20）
```

### 1.2 認証の優先順位

1. `CRM_SESSION_TOKEN` が設定されていればそれを使用
2. なければ `CRM_LOGIN_EMAIL` + `CRM_LOGIN_PASSWORD` でログイン

### 1.3 セキュリティ注意事項

- `.env` ファイルは `.gitignore` に含まれています（コミットされません）
- パスワードやトークンをログに出力しないでください
- 本番環境では環境変数で設定してください

---

## 2. CLI 実行手順

### 2.1 依存関係のインストール

```bash
cd /Users/cl/Desktop/AI-Sales
npm install
```

### 2.2 テストの実行

```bash
npm test
```

### 2.3 crm_debug CLI

#### モックデータでテスト

```bash
npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡" --mock
```

#### 実環境でテスト

```bash
# .env が設定されていることを確認
npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡"
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--tag <tag>` | 検索するタグ（必須） | - |
| `--mock` | モックデータを使用 | false |
| `--limit <n>` | 表示件数 | 10 |
| `--verbose` | 詳細出力 | false |
| `--base-url <url>` | API URL を上書き | CRM_BASE_URL |

### 2.4 run_one_company CLI (フルパイプライン)

タグ検索 → 会社選択 → 候補者提案 → メール作成 → Gmail下書き作成の一気通貫パイプライン。

#### 基本使用法

```bash
# タグで検索し、最初の会社を処理
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡"

# 特定の会社IDを指定
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --company-id 123

# ドライラン（Gmail下書き作成をスキップ、メール内容のみ出力）
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --dry-run

# JSON出力のみ（スクリプト連携用）
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --json
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--tag <tag>` | 検索するタグ（必須） | - |
| `--company-id <id>` | 処理する会社ID | 最初の会社 |
| `--dry-run` | Gmail下書き作成をスキップ | false |
| `--verbose` | 詳細出力 | false |
| `--json` | JSON出力のみ | false |

#### 出力例

```json
{
  "success": true,
  "tag": "南部・3月連絡",
  "tagNormalized": {
    "region": "南部",
    "contactMonth": 3,
    "contactYear": 2026
  },
  "company": {
    "id": "123",
    "name": "ABC Manufacturing Co., Ltd.",
    "region": "南部"
  },
  "searchResultCount": 15,
  "candidatesCount": 3,
  "email": {
    "subject": "【CareerLink】ABC Manufacturing Co., Ltd.様へ人材のご提案",
    "bodyPreview": "ABC Manufacturing Co., Ltd. ご担当者様...",
    "bodyLength": 850
  },
  "gmailDraft": {
    "draftId": "stub-draft-1706281234567",
    "isStub": true
  },
  "errors": [],
  "mode": {
    "dryRun": false,
    "gmailConfigured": false,
    "candidateStub": true
  }
}
```

#### 動作モード

1. **Gmail Stub Mode**: `GMAIL_*` 環境変数が未設定の場合、スタブIDを返します
2. **Candidate Stub Mode**: `CANDIDATE_MODE=stub`（デフォルト）の場合、スタブ候補者を返します
3. **Candidate Real Mode**: `CANDIDATE_MODE=real` で実APIを使用（`CANDIDATE_API_URL`, `CANDIDATE_API_KEY`必須）
4. **Dry Run Mode**: `--dry-run` でメール内容を確認できます

### 2.5 run_daily_queue CLI (日次優先度キュー)

タグで企業を検索し、優先度スコア順にリストを生成します。

#### 基本使用法

```bash
# タグで検索し、上位20社を表示
npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --top 20

# JSON出力（スクリプト連携用）
npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --json

# 対話選択モード（企業を選択してパイプライン実行）
npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --select

# 全企業表示（既存顧客・要整備含む）
npx ts-node src/cli/run_daily_queue.ts --tag "南部・3月連絡" --show-all
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--tag <tag>` | 検索するタグ（必須） | - |
| `--top <n>` | 表示件数 | 20 |
| `--json` | JSON出力のみ | false |
| `--select` | 対話選択モード | false |
| `--show-all` | 特殊バケット含む全件表示 | false |

#### 優先度バケット

| バケット | スコア範囲 | 説明 |
|----------|-----------|------|
| 高優先 | 70-100点 | 優先的に連絡すべき企業 |
| 通常 | 40-69点 | 通常の連絡対象 |
| 低優先 | 0-39点 | 後回しでもよい企業 |
| 既存顧客 | - | 契約中の顧客（別管理） |
| 要整備 | - | データ不備あり（メール未登録等） |

---

## 3. よくあるエラーと対処

### 3.1 AuthError: No authentication method available

**原因**: 認証情報が設定されていない

**対処**:
1. `.env` ファイルが存在することを確認
2. `CRM_SESSION_TOKEN` または `CRM_LOGIN_EMAIL` + `CRM_LOGIN_PASSWORD` が設定されていることを確認

```bash
# .env の存在確認
ls -la .env

# 環境変数の確認（値は表示しない）
grep -c CRM_ .env
```

### 3.2 AuthError: Invalid credentials

**原因**: メールアドレスまたはパスワードが間違っている

**対処**:
1. `.env` のメールアドレスとパスワードを確認
2. CRM に直接ログインできるか確認
3. アカウントがロックされていないか確認

### 3.3 AuthError: Session expired or invalid

**原因**: セッショントークンの有効期限切れ

**対処**:
1. `CRM_SESSION_TOKEN` を削除
2. `CRM_LOGIN_EMAIL` + `CRM_LOGIN_PASSWORD` で再認証させる
3. または新しいトークンを取得して設定

### 3.4 NetworkError: HTTP 404

**原因**: エンドポイントが存在しない

**対処**:
1. `CRM_BASE_URL` が正しいか確認
2. CRM サーバーが稼働しているか確認
3. URLの末尾に `/` がないことを確認

### 3.5 NetworkError: ECONNREFUSED

**原因**: CRM サーバーに接続できない

**対処**:
1. CRM サーバーが起動しているか確認
2. ネットワーク接続を確認
3. ファイアウォールの設定を確認

### 3.6 NetworkError: HTTP 429 (Rate Limit)

**原因**: APIリクエスト過多

**対処**:
1. しばらく待ってから再試行
2. ページング時の `maxPages` を減らす
3. リクエスト間隔を空ける

---

## 4. ログとデバッグ

### 4.1 詳細ログの有効化

```bash
npx ts-node src/cli/crm_debug.ts --tag "南部・3月連絡" --verbose
```

### 4.2 ログに出してはいけない情報

- パスワード
- セッショントークン
- メール本文
- 候補者の氏名・連絡先

### 4.3 安全なデバッグ方法

```typescript
// NG: トークンを出力
console.log(`Token: ${token}`);

// OK: トークンの有無だけ確認
console.log(`Token: ${token ? '[SET]' : '[NOT SET]'}`);
```

---

## 5. トラブルシューティングチェックリスト

1. [ ] `.env` ファイルが存在する
2. [ ] 認証情報が設定されている
3. [ ] `CRM_BASE_URL` が正しい
4. [ ] CRM サーバーが稼働している
5. [ ] ネットワーク接続がある
6. [ ] npm install が完了している
7. [ ] TypeScript がコンパイルできる

---

## 6. メール生成機能

### 6.1 B案仕様（候補者経歴要約）

メール本文に候補者の経歴要約（careerSummary）を含めます。

- 最大400文字
- PII（個人情報）が含まれる場合は候補者を除外
- 推薦理由は最大3つまで表示

### 6.2 PII検出と除外

ContentGuards モジュールが以下のPIIを検出し、該当候補者を除外します：

- メールアドレス
- 電話番号（日本形式）
- 住所（日本語・ベトナム語）
- 生年月日
- 具体的な会社名

除外された候補者は監査ログに記録されます。

### 6.3 トラッキングID

メール送信の効果測定（返信率/商談化）のため、各メールにトラッキングIDを付与します。

**形式**: `[CL-AI:xxxxxxxx]`（8桁の16進数）

**埋め込み位置**:
- 件名の末尾
- 本文の署名直前

**目的**:
- 返信メールとの紐付け
- どの企業・候補者・テンプレートで送ったかの追跡
- A/Bテストの効果測定

**例**:
```
件名: 【CareerLink】ABC会社様へ人材のご提案 [CL-AI:a1b2c3d4]
```

### 6.4 A/Bテンプレート運用

同じ内容を異なる表現で送信し、効果を比較します。

**割当ルール**:
- 企業IDのハッシュ値で決定（deterministic）
- 同じ企業は常に同じバリアントを受信
- 約50/50で分配

**バリアント差分**:

| 要素 | Variant A | Variant B |
|------|-----------|-----------|
| 件名 | 【CareerLink】○○様へ人材のご提案 | ○○様向け 厳選人材のご案内 - CareerLink |
| 候補者見出し | 【ご紹介候補者】 | --- 厳選候補者のご紹介 --- |
| CTA | 詳細な履歴書をお送りいたします | 面談をご希望の場合は、本メールへのご返信で |

**テンプレートID**:
- `new_candidates_v1_A`: バリアントA
- `new_candidates_v1_B`: バリアントB

**監査ログでの確認**:
```bash
# バリアント別の集計
cat logs/audit.ndjson | jq -s 'group_by(.abVariant) | map({variant: .[0].abVariant, count: length})'
```

---

## 7. 監査とログ

### 7.1 監査ログ

パイプライン実行のログは `logs/audit.ndjson` に記録されます。

```bash
# 最新のログを確認
tail -10 logs/audit.ndjson | jq .
```

記録される情報：
- タイムスタンプ
- イベントタイプ（pipeline_run, draft_created, validation_failed）
- 検索タグ
- 企業ID（名前はハッシュ化）
- 候補者の除外情報
- 下書きID
- トラッキングID（tracking_id）
- テンプレートID（template_id）
- A/Bバリアント（ab_variant）

**注意**: logs/ ディレクトリは .gitignore に含まれています。

### 7.2 Approval Token

下書き作成時に承認トークンが生成されます。

- HMAC-SHA256で署名
- 24時間有効
- 将来の送信機能のための準備（現在はドラフト作成のみ）

本番環境では `APPROVAL_TOKEN_SECRET` 環境変数を必ず設定してください。

### 7.3 ログに出してはいけない情報

- パスワード、トークン
- 候補者の氏名、連絡先、経歴詳細
- 企業の連絡先メール
- メール本文全体

### 7.4 計測データ（metrics.ndjson）

送信/返信の効果測定データは `data/metrics.ndjson` に記録されます。

**イベントタイプ**:
- `DRAFT_CREATED`: 下書き作成時
- `SENT_DETECTED`: Gmail送信検出時
- `REPLY_DETECTED`: 返信検出時
- `AUTO_SEND_ATTEMPT`: 自動送信試行時
- `AUTO_SEND_SUCCESS`: 自動送信成功時
- `AUTO_SEND_BLOCKED`: 自動送信ブロック時（理由付き）
- `SEND_APPROVED`: 送信承認時（approve_send成功）

**記録される情報**:
- タイムスタンプ
- トラッキングID
- 企業ID
- テンプレートID
- A/Bバリアント
- GmailスレッドID
- 返信レイテンシ（時間）

**記録されない情報（PII禁止）**:
- メールアドレス
- メール本文
- 候補者の経歴要約（careerSummary）
- 企業名
- 候補者名

**注意**: data/ ディレクトリは .gitignore に含まれています。

### 7.5 Gmail送信/返信スキャン

監査ログからトラッキングIDを取得し、Gmailで送信済み・返信を検出します。

**重要**: 送信は手動で行います。送信検出は本スキャンで自動的に行われます。

#### 実行方法

```bash
# 基本実行
npx ts-node src/cli/scan_gmail_responses.ts

# 特定日以降のみスキャン
npx ts-node src/cli/scan_gmail_responses.ts --since "2026-01-15"

# JSON出力
npx ts-node src/cli/scan_gmail_responses.ts --json
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--since <date>` | この日付以降の監査ログをスキャン | 全件 |
| `--json` | JSON出力のみ | false |

#### 出力例

```json
{
  "processed": 25,
  "skipped": 3,
  "sentDetected": 18,
  "replyDetected": 5,
  "errors": []
}
```

#### 動作モード

- **Gmail Stub Mode**: `GMAIL_*` 環境変数が未設定の場合、スキャンをスキップします
- **Real Mode**: Gmail APIで実際に検索を実行します

### 7.6 A/Bメトリクスレポート

テンプレート/バリアント別の効果測定レポートを生成します。

#### 実行方法

```bash
# 基本実行（全期間）
npx ts-node src/cli/report_ab_metrics.ts

# 特定日以降のデータのみ
npx ts-node src/cli/report_ab_metrics.ts --since "2026-01-01"

# JSON出力
npx ts-node src/cli/report_ab_metrics.ts --json
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--since <date>` | この日付以降のイベントのみ | 全件 |
| `--json` | JSON出力のみ | false |
| `--markdown` | Markdown形式で出力 | false |
| `--include-decision` | 統計的判定結果を含める | false |

#### 出力例（テーブル形式）

```
======================================================================
A/B Metrics Report
======================================================================

Period:
  From: 2026-01-01
  To:   2026-01-26T10:00:00.000Z

Overall Metrics:
----------------------------------------
  Drafts created:      50
  Sent (detected):     45
  Replies (detected):  12
  Reply rate:          26.7%
  Median reply time:   18.5h

By Template/Variant:
----------------------------------------------------------------------
Template ID                  | Variant | Drafts | Sent | Replies | Rate
----------------------------------------------------------------------
new_candidates_v1            | A       |     25 |   23 |       8 | 34.8%
new_candidates_v1            | B       |     25 |   22 |       4 | 18.2%
----------------------------------------------------------------------
```

#### 計算ロジック

- **返信率**: `replies / sent_detected`（draftは分母にしない）
- **中央値レイテンシ**: 返信検出時に計算された `replyLatencyHours` の中央値
- **バリアント比較**: 同一テンプレートのA/Bを並べて表示

### 7.7 実験メタデータ（experiments.json）

A/Bテストの実験設定は `config/experiments.json` で管理します。

#### 構造

```json
{
  "experiments": [
    {
      "experimentId": "ab_subject_cta_v1",
      "name": "Subject and CTA A/B Test v1",
      "startDate": "2026-01-26",
      "endDate": null,
      "primaryMetric": "reply_rate",
      "minSentPerVariant": 50,
      "decisionRule": {
        "alpha": 0.05,
        "minLift": 0.02
      },
      "status": "running",
      "startAt": "2026-01-26T00:00:00.000Z",
      "endAt": null,
      "freezeOnLowN": true,
      "rollbackRule": {
        "maxDaysNoReply": 7,
        "minSentTotal": 100,
        "minReplyRate": 0.02
      },
      "templates": [
        { "templateId": "new_candidates_v1_A", "variant": "A", "status": "active" },
        { "templateId": "new_candidates_v1_B", "variant": "B", "status": "active" }
      ]
    }
  ]
}
```

#### 設定項目

| 項目 | 説明 |
|------|------|
| `experimentId` | 実験の一意識別子 |
| `minSentPerVariant` | 判定に必要な最小送信数（デフォルト: 50） |
| `decisionRule.alpha` | 有意水準（デフォルト: 0.05 = 5%） |
| `decisionRule.minLift` | 勝者判定に必要な最小リフト（デフォルト: 0.02 = 2%） |
| `templates[].status` | `active`（使用中）または `archived`（昇格後の敗者） |

#### ライフサイクル管理フィールド（P3-7追加）

| 項目 | 型 | 説明 |
|------|-----|------|
| `status` | `running` \| `paused` \| `ended` | 実験のステータス（デフォルト: `running`） |
| `startAt` | ISO8601文字列 | 実験開始日時（この時刻前はA/B割当されない） |
| `endAt` | ISO8601文字列 | 実験終了日時（この時刻以降はA/B割当されない） |
| `freezeOnLowN` | boolean | 低サンプル時に凍結を推奨するか（デフォルト: `false`） |
| `rollbackRule` | オブジェクト | ロールバック判定ルール |

#### rollbackRule設定

| 項目 | 型 | 説明 | デフォルト |
|------|-----|------|-----------|
| `maxDaysNoReply` | number | 返信なしでロールバック推奨になる日数 | 7 |
| `minSentTotal` | number | ロールバック判定に必要な最小送信数 | 100 |
| `minReplyRate` | number | 下回るとロールバック推奨になる返信率 | 0.02 (2%) |

#### ステータス遷移

```
running → paused → running  # 一時停止→再開
running → ended             # 終了（勝者昇格後など）
running → paused → ended    # 一時停止→終了
```

- **running**: A/B割当の対象。`startAt` 〜 `endAt` の範囲内で有効
- **paused**: A/B割当から除外。データ収集は継続
- **ended**: 完全に終了。A/B割当なし、レポートのみ可能

### 7.8 A/B勝者判定と昇格（promote_winner）

統計的に有意な勝者を判定し、テンプレートを昇格します。

#### 実行方法

```bash
# 判定のみ（dry-run）
npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1" --dry-run

# 判定＋昇格実行
npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1"

# JSON出力
npx ts-node src/cli/promote_winner.ts --experiment "ab_subject_cta_v1" --json
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--experiment <id>` | 実験ID（必須） | - |
| `--since <date>` | この日付以降のデータのみ使用 | 全件 |
| `--dry-run` | 判定のみ、変更なし | false |
| `--json` | JSON出力のみ | false |

#### 判定ロジック

1. **サンプルサイズ確認**: 各バリアントが `minSentPerVariant` 以上あるか
2. **z検定**: 二項比率の差の検定（two-tailed）
3. **有意水準確認**: p値 < alpha であるか
4. **最小リフト確認**: 差が minLift 以上あるか

#### 昇格時の動作

1. `config/experiments.json.bak-YYYYMMDDHHmmss` にバックアップ作成
2. 勝者テンプレート: `status = "active"`
3. 敗者テンプレート: `status = "archived"`
4. 実験の `endDate` を設定

#### 判定不可の場合の対処

| 理由 | 対処方法 |
|------|----------|
| `insufficient_data_*` | 母数を増やす（期間延長、送信数増加） |
| `no_significant_difference` | 期間を延長してデータを蓄積 |
| `lift_below_threshold` | 実質的に同等。どちらを使っても可 |

#### 運用サイクル（推奨）

1. **週1回**: `report_ab_metrics.ts --include-decision` で状況確認
2. **判定可能時**: `promote_winner.ts --dry-run` で確認
3. **問題なければ**: `promote_winner.ts` で昇格実行
4. **昇格後**: 新しいA/Bテストを設計（必要に応じて）

### 7.9 セグメント定義（segments.json）

セグメント分類の定義は `config/segments.json` で管理します。

#### セグメント種別

| セグメント | 値 | 説明 |
|------------|-----|------|
| `region` | 南部, 中部, 北部, 不明 | 地域（タグまたは会社情報から） |
| `customerState` | existing, new, unknown | 顧客状態（契約履歴から） |
| `industryBucket` | IT, 製造, サービス, その他, 不明 | 業種（会社プロフィールから） |

#### 分類ルール

1. **region**: タグの地域 → 会社location.region → province の順で判定
2. **customerState**: 連絡履歴に `contract` アクションがあれば `existing`
3. **industryBucket**: 会社のindustryTextを正規表現で分類（LLM不使用）

**重要**: 判定できない場合は「不明/unknown」に落とす（推定しない）

### 7.10 セグメント別メトリクスレポート

セグメント別の返信率・返信速度を可視化します。

#### 実行方法

```bash
# 基本実行
npx ts-node src/cli/report_segment_metrics.ts

# 特定日以降
npx ts-node src/cli/report_segment_metrics.ts --since "2026-01-15"

# Markdown出力＋判定結果
npx ts-node src/cli/report_segment_metrics.ts --markdown --include-decision

# 最小送信数を変更（デフォルト: 30）
npx ts-node src/cli/report_segment_metrics.ts --min-sent 50
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--since <date>` | この日付以降のイベントのみ | 全件 |
| `--json` | JSON出力のみ | false |
| `--markdown` | Markdown形式で出力 | false |
| `--min-sent <n>` | 信頼できる最小送信数 | 30 |
| `--include-decision` | 探索的A/B判定を含める | false |

#### 出力内容

- **By Region**: 地域別のテンプレート/バリアント別メトリクス
- **By Customer State**: 顧客状態別のメトリクス
- **By Industry Bucket**: 業種別のメトリクス

各行に `insufficient_n` フラグが付く場合、その行は母数不足で信頼性が低いことを示します。

#### セグメント判定の注意事項

> **重要**: セグメント別のA/B判定は**探索的（exploratory）**です。

- 多重比較補正（Bonferroni等）は適用されていません
- 仮説生成には使用可能ですが、最終判断には使用しないでください
- 母数不足のセグメントは `winner=null, reason="insufficient_n"` となります
- 本番の昇格判断は全体のA/B判定（`promote_winner.ts`）で行ってください

### 7.11 テンプレート改善提案（propose_templates）

メトリクスとセグメント結果から、改善が必要なテンプレートを自動検出し、改善案を提案します。

#### 実行方法

```bash
# 基本実行（提案生成のみ）
npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15"

# ドライラン（ファイル更新なし）
npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15" --dry-run

# 特定セグメントのみ対象
npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15" --segment "region=南部"

# JSON出力
npx ts-node src/cli/propose_templates.ts --experiment "ab_subject_cta_v1" --since "2026-01-15" --json
```

#### オプション

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--experiment <id>` | 実験ID（必須） | - |
| `--since <date>` | この日付以降のデータを使用（必須） | - |
| `--segment <filter>` | セグメント絞り込み（例: `region=南部`） | 全セグメント |
| `--min-sent <n>` | 候補として考慮する最小送信数 | 50 |
| `--min-gap <n>` | 最良との差が何%以上で改善対象とするか | 0.03 (3%) |
| `--max-proposals <n>` | 生成する最大提案数 | 5 |
| `--dry-run` | ファイル更新なし | false |
| `--json` | JSON出力のみ | false |

#### 改善候補の選定ロジック（ImprovementPicker）

1. セグメント×テンプレート×バリアント別にメトリクスを集計
2. 各セグメント内で最良の返信率/レイテンシを特定
3. 最良との差が `minGap` 以上のテンプレートを改善候補として選定
4. 差が大きい順にソートし、`maxCandidates` 件に絞り込み

#### 提案生成ロジック（TemplateGenerator）

改善候補に対して、ルールベースで改善案を生成します（LLMは使用しない）。

**適用される改善戦略**:

| 戦略 | 適用条件 | 変更内容 |
|------|----------|----------|
| `add_urgency` | 返信率低下 | 件名・CTAに時間的緊急性を追加 |
| `add_question` | 返信率低下 | 件名・CTAを質問形式に |
| `personalize` | 返信率低下 | 会社名を追加して個別感を強調 |
| `add_specificity` | 一般的なテンプレート | 提供物を具体的に明記 |
| `soften_tone` | バリアントB（厳選系） | トーンを柔らかく |
| `simplify` | レイテンシ高い | 冗長な表現を削除 |

#### 提案の追加（experiments.json）

`--dry-run` なしで実行すると、`config/experiments.json` に提案が追加されます。

```json
{
  "templateId": "new_candidates_v1_B_add_urgency_abc123",
  "variant": "B",
  "status": "proposed",
  "proposedAt": "2026-01-26T10:00:00.000Z",
  "baseTemplateId": "new_candidates_v1_B",
  "changes": [
    {
      "field": "subjectTemplate",
      "type": "urgency",
      "description": "Added time-sensitive language",
      "before": "...",
      "after": "..."
    }
  ],
  "targetSegment": { "segmentName": "region", "segmentValue": "南部" }
}
```

**重要**:
- 追加されるテンプレートの `status` は `"proposed"` です
- `"proposed"` ステータスのテンプレートはA/B割当に使用されません
- `approve_templates.ts` CLI で承認するまで有効化されません
- バックアップが `config/experiments.json.bak-YYYYMMDDHHmmss` に作成されます

#### 制約事項

- **自動昇格禁止**: 提案は `"proposed"` ステータスで追加され、自動的に有効化されません
- **PII不使用**: 改善提案の生成にPIIは使用しません（テンプレートテキストのみ）
- **ルールベース**: LLMを使用せず、事前定義された戦略パターンで生成します

### 7.12 テンプレート承認（approve_templates）

proposedステータスのテンプレートを承認し、activeに昇格します。

#### 実行方法

```bash
# 基本実行（承認実行）
npx ts-node src/cli/approve_templates.ts \
  --experiment "ab_subject_cta_v1" \
  --template-id "new_candidates_v1_B_add_urgency_abc123" \
  --approved-by "山田太郎" \
  --reason "南部セグメントで返信率向上が期待できるため"

# チケット参照付き
npx ts-node src/cli/approve_templates.ts \
  --experiment "ab_subject_cta_v1" \
  --template-id "new_candidates_v1_B_add_urgency_abc123" \
  --approved-by "山田太郎" \
  --reason "JIRA-456の承認に基づく" \
  --ticket "JIRA-456"

# ドライラン（変更なし、品質ゲートチェックのみ）
npx ts-node src/cli/approve_templates.ts \
  --experiment "ab_subject_cta_v1" \
  --template-id "new_candidates_v1_B_add_urgency_abc123" \
  --approved-by "山田太郎" \
  --reason "テスト" \
  --dry-run

# JSON出力
npx ts-node src/cli/approve_templates.ts \
  --experiment "ab_subject_cta_v1" \
  --template-id "..." \
  --approved-by "..." \
  --reason "..." \
  --json
```

#### オプション

| オプション | 説明 | 必須 |
|------------|------|------|
| `--experiment <id>` | 実験ID | ✓ |
| `--template-id <id>` | 承認するテンプレートID | ✓ |
| `--approved-by <name>` | 承認者名/ID | ✓ |
| `--reason <reason>` | 承認理由 | ✓ |
| `--ticket <ticket>` | 参照チケット（例: JIRA-123） | - |
| `--dry-run` | 変更なし、チェックのみ | - |
| `--json` | JSON出力のみ | - |

#### 品質ゲート（TemplateQualityGate）

承認前に以下のチェックが行われます。**1つでも違反があると承認不可**です。

| チェック項目 | 内容 | 上限/禁止事項 |
|--------------|------|---------------|
| PII検出 | メール、電話、住所、生年月日 | 混入禁止 |
| 件名長さ | subject_template | 80文字以下 |
| CTA長さ | cta_template | 200文字以下 |
| 見出し長さ | candidate_header_template | 80文字以下 |
| 禁止表現 | 誇大表現・煽り | 「確実に」「絶対」「保証」「必ず」「100%」「今だけ」「限定」「緊急」等 |
| トラッキングタグ | [CL-AI:xxxx] | テンプレートに含めない（自動付与されるため） |

#### 承認時の動作

1. 品質ゲートチェック実行
2. 違反がある場合は中断（承認ログにfailを記録）
3. 違反がない場合:
   - `config/experiments.json.bak-YYYYMMDDHHmmss` にバックアップ作成
   - 同一variantの現在activeテンプレートを `archived` に変更
   - 対象テンプレートを `proposed` → `active` に変更
   - 承認ログを `data/approvals.ndjson` に追記

#### 承認ログ（data/approvals.ndjson）

承認/拒否の監査ログが記録されます。**PIIは含まれません**。

```json
{
  "timestamp": "2026-01-26T10:00:00.000Z",
  "experimentId": "ab_subject_cta_v1",
  "templateId": "new_candidates_v1_B_add_urgency_abc123",
  "previousActiveTemplateId": "new_candidates_v1_B",
  "approvedBy": "山田太郎",
  "reason": "南部セグメントで返信率向上が期待できるため",
  "ticket": "JIRA-456",
  "qualityGateOk": true,
  "violations": []
}
```

#### 運用フロー（推奨）

1. **週1回**: `report_segment_metrics.ts` でセグメント別パフォーマンスを確認
2. **改善対象発見時**: `propose_templates.ts --dry-run` で提案内容を確認
3. **問題なければ**: `propose_templates.ts` で提案を追加
4. **提案レビュー**: `experiments.json` の提案内容を人間がレビュー
5. **承認時**: `approve_templates.ts` で承認（品質ゲート通過必須）
6. **翌週**: 新テンプレートでA/Bテスト稼働開始

#### テンプレートステータス確認

`report_ab_metrics.ts --show-templates` でactive/proposedのテンプレート一覧を確認できます。

```bash
npx ts-node src/cli/report_ab_metrics.ts --show-templates
```

出力例:
```
Template Status:
----------------------------------------------------------------------
  ab_subject_cta_v1 (Subject and CTA A/B Test v1):
    Active:
      - new_candidates_v1_A [A]
      - new_candidates_v1_B [B]
    Proposed:
      - new_candidates_v1_B_add_urgency_abc123 [B]
    Archived: 0
```

#### 重要な制約

- **proposedはA/B割当されない**: `status="proposed"` のテンプレートは自動的にA/B割当に使用されません
- **activeのみ割当対象**: ABAssignerは `status="active"` のテンプレートのみを使用します
- **承認必須**: proposed → active への昇格は必ず `approve_templates.ts` を使用し、承認者・理由を記録してください

### 7.13 統合運用CLI（run_ops）

各運用タスクを統一インターフェースで実行できるCLIです。

#### 基本使用法

```bash
# サブコマンドヘルプ
npx ts-node src/cli/run_ops.ts --help

# 各サブコマンドの実行
npx ts-node src/cli/run_ops.ts <subcommand> [options]
```

#### サブコマンド一覧

| サブコマンド | 説明 | 内部実行 |
|--------------|------|----------|
| `scan` | Gmail送信/返信スキャン | scan_gmail_responses.ts |
| `report` | A/Bメトリクスレポート | report_ab_metrics.ts |
| `propose` | テンプレート改善提案 | propose_templates.ts |
| `promote` | 勝者昇格 | promote_winner.ts |
| `approve` | テンプレート承認 | approve_templates.ts |
| `safety` | 実験安全性チェック | ExperimentSafetyCheck |
| `status` | 実験ステータス確認 | ExperimentScheduler |
| `send` | 下書き送信（限定パイロット） | send_draft.ts |
| `approve-send` | 承認→送信ワンコマンド | approve_send.ts + send_draft.ts |
| `stop-send` | 緊急停止（RuntimeKillSwitch有効化） | RuntimeKillSwitch |
| `resume-send` | 送信再開（RuntimeKillSwitch無効化） | RuntimeKillSwitch |
| `stop-status` | キルスイッチ/送信ポリシー状態確認 | SendPolicy + RuntimeKillSwitch |
| `rollback` | 実験ロールバック | rollback_experiment.ts |
| `ramp-status` | 段階リリース状況確認 | RampPolicy |
| `auto-stop` | 自動停止評価（メトリクス監視） | AutoStopJob |

#### scan サブコマンド

```bash
# 全件スキャン
npx ts-node src/cli/run_ops.ts scan

# 特定日以降
npx ts-node src/cli/run_ops.ts scan --since "2026-01-15"
```

#### report サブコマンド

```bash
# 基本レポート
npx ts-node src/cli/run_ops.ts report

# Markdown出力 + 判定結果
npx ts-node src/cli/run_ops.ts report --markdown --include-decision

# テンプレートステータス表示
npx ts-node src/cli/run_ops.ts report --show-templates
```

#### propose サブコマンド

```bash
# 提案生成（ドライラン）
npx ts-node src/cli/run_ops.ts propose --experiment "ab_subject_cta_v1" --since "2026-01-15" --dry-run

# 提案実行
npx ts-node src/cli/run_ops.ts propose --experiment "ab_subject_cta_v1" --since "2026-01-15"
```

#### promote サブコマンド

```bash
# 判定のみ（ドライラン）
npx ts-node src/cli/run_ops.ts promote --experiment "ab_subject_cta_v1" --dry-run

# 昇格実行
npx ts-node src/cli/run_ops.ts promote --experiment "ab_subject_cta_v1"
```

#### approve サブコマンド

```bash
npx ts-node src/cli/run_ops.ts approve \
  --experiment "ab_subject_cta_v1" \
  --template-id "new_candidates_v1_B_add_urgency_abc123" \
  --approved-by "山田太郎" \
  --reason "南部セグメントで改善が期待できるため"
```

#### safety サブコマンド

```bash
# 全running実験をチェック
npx ts-node src/cli/run_ops.ts safety

# 特定実験のみ
npx ts-node src/cli/run_ops.ts safety --experiment "ab_subject_cta_v1"

# 特定期間のデータで判定
npx ts-node src/cli/run_ops.ts safety --experiment "ab_subject_cta_v1" --since "2026-01-20"
```

#### status サブコマンド

```bash
# アクティブな実験を表示
npx ts-node src/cli/run_ops.ts status

# 全実験のステータス表示
npx ts-node src/cli/run_ops.ts status --all
```

#### send サブコマンド

下書きを送信します（限定パイロット機能）。

**前提条件**:
- `ENABLE_AUTO_SEND=true` が設定されていること
- `KILL_SWITCH=false`（またはKILL_SWITCH未設定）
- 送信先が `SEND_ALLOWLIST_DOMAINS` または `SEND_ALLOWLIST_EMAILS` に含まれていること
- 下書きがDraftRegistryに登録されていること（本システムで作成された下書きのみ送信可能）
- 有効なApprovalTokenが提供されること（draft_idとtracking_idが一致すること）

```bash
# 実際に送信
npx ts-node src/cli/run_ops.ts send \
  --draft-id "draft-123" \
  --to "user@allowed-domain.com" \
  --approval-token "..."
```

#### approve-send サブコマンド（推奨）

下書きの承認と送信をワンコマンドで実行します。これが推奨ワークフローです。

```bash
# ドライラン（承認トークン発行 + 送信可能性確認、実際には送信しない）
npx ts-node src/cli/run_ops.ts approve-send \
  --draft-id "draft-123" \
  --approved-by "承認者名" \
  --reason "南部パイロット" \
  --to "user@allowed-domain.com"

# 実際に送信（--execute を付ける）
npx ts-node src/cli/run_ops.ts approve-send \
  --draft-id "draft-123" \
  --approved-by "承認者名" \
  --reason "南部パイロット" \
  --to "user@allowed-domain.com" \
  --execute

# チケット参照付き
npx ts-node src/cli/run_ops.ts approve-send \
  --draft-id "draft-123" \
  --approved-by "承認者名" \
  --reason "JIRA-123の承認に基づく" \
  --ticket "JIRA-123" \
  --to "user@allowed-domain.com" \
  --execute
```

**オプション**:

| オプション | 説明 | 必須 |
|------------|------|------|
| `--draft-id <id>` | Gmail下書きID | ✓ |
| `--approved-by <name>` | 承認者名/ID | ✓ |
| `--reason <reason>` | 承認理由 | ✓ |
| `--to <email>` | 送信先（--execute時は必須） | - |
| `--ticket <ticket>` | 参照チケット | - |
| `--execute` | 承認後に実際に送信 | - |
| `--json` | JSON出力 | - |

### 7.14 DraftRegistry（下書き登録）

`run_one_company` で作成された下書きのメタ情報を `data/drafts.ndjson` に記録します。

#### 目的

- **本システムで生成された下書きのみ送信可能にする**セキュリティ制御
- 承認トークンの `draft_id` と `tracking_id` を検証し、改竄を防止
- 送信時に tracking_id/company_id/template_id/ab_variant を自動取得

#### 保存される情報（PII-free）

| フィールド | 説明 |
|------------|------|
| `timestamp` | 作成日時 |
| `draftId` | Gmail下書きID |
| `trackingId` | トラッキングID |
| `companyId` | 企業ID |
| `templateId` | テンプレートID |
| `abVariant` | A/Bバリアント |
| `subjectHash` | 件名のSHA-256ハッシュ（件名自体は保存しない） |
| `bodyHash` | 本文のSHA-256ハッシュ（本文自体は保存しない） |
| `toDomain` | 送信先ドメインのみ（フルメールアドレスは保存しない） |

**重要**: subject/bodyはハッシュのみ保存し、PIIは一切保存しません。

### 7.15 送信承認（approve_send CLI）

下書きの送信を承認し、ApprovalTokenを発行します。

#### 実行方法

```bash
npx ts-node src/cli/approve_send.ts \
  --draft-id "draft-123" \
  --approved-by "承認者名" \
  --reason "パイロット承認"
```

#### 動作

1. DraftRegistryから `draft_id` を検索し、`tracking_id` 等を取得
2. 見つからなければ拒否（本システム外の下書きは承認不可）
3. ApprovalTokenを発行（ペイロードに `draft_id` + `tracking_id` を含む）
4. `data/approvals.ndjson` に承認ログを追記（token全文は保存せず、fingerprintのみ）
5. トークンを標準出力に返す

#### 承認ログ（data/approvals.ndjson）

```json
{
  "timestamp": "2026-01-26T10:00:00.000Z",
  "type": "send",
  "draftId": "draft-123",
  "trackingId": "track-abc",
  "companyId": "company-xyz",
  "templateId": "template-001",
  "abVariant": "A",
  "approvedBy": "承認者名",
  "reason": "パイロット承認",
  "ticket": "JIRA-123",
  "tokenFingerprint": "abc123def456..."
}
```

**重要**: トークン全文は保存せず、fingerprint（SHA-256の先頭16文字）のみ保存します。

### 7.16 自動送信（send_draft CLI）

下書きを送信するCLIです。**限定パイロット**として、厳格な安全制御の下で運用されます。

#### 設計原則

1. **デフォルトは送信しない**: `ENABLE_AUTO_SEND=true` が明示的に設定されていない限り、送信は行われません
2. **DraftRegistry必須**: 本システムで作成された下書き（DraftRegistryに登録済み）のみ送信可能
3. **承認トークン必須**: ApprovalTokenが有効で、`draft_id` と `tracking_id` が一致すること
4. **Allowlist制限**: 送信先は `SEND_ALLOWLIST_DOMAINS` または `SEND_ALLOWLIST_EMAILS` に含まれている必要があります
5. **緊急停止**: `KILL_SWITCH=true` で即座に全送信を停止できます
6. **レート制限**: `SEND_MAX_PER_DAY` で日次送信数を制限します（デフォルト: 20）
7. **PreSendGate**: 送信前にPII検出、禁止表現チェック、トラッキングタグ確認を実施します

#### 実行方法

```bash
# 基本使用法
npx ts-node src/cli/send_draft.ts \
  --draft-id "draft-123" \
  --to "user@allowed-domain.com" \
  --approval-token "..."

# フルオプション
npx ts-node src/cli/send_draft.ts \
  --draft-id "draft-123" \
  --to "user@allowed-domain.com" \
  --approval-token "..." \
  --tracking-id "track123" \
  --company-id "company123" \
  --template-id "template123" \
  --ab-variant "A" \
  --subject "件名 [CL-AI:a1b2c3d4]" \
  --body "メール本文..." \
  --dry-run
```

#### オプション

| オプション | 説明 | 必須 |
|------------|------|------|
| `--draft-id <id>` | Gmail下書きID | ✓ |
| `--to <email>` | 送信先メールアドレス | ✓ |
| `--approval-token <token>` | 承認トークン | ✓ |
| `--tracking-id <id>` | トラッキングID | - |
| `--company-id <id>` | 企業ID（メトリクス用） | - |
| `--template-id <id>` | テンプレートID（メトリクス用） | - |
| `--ab-variant <A\|B>` | A/Bバリアント（メトリクス用） | - |
| `--subject <subject>` | 件名（PreSendGateチェック用） | - |
| `--body <body>` | 本文（PreSendGateチェック用） | - |
| `--dry-run` | チェックのみ、送信しない | - |
| `--json` | JSON出力のみ | - |

#### 安全制御の流れ

```
1. DraftRegistry チェック → 登録されていない下書きはブロック
2. KILL_SWITCH チェック → true なら即座にブロック
3. ENABLE_AUTO_SEND チェック → false ならブロック
4. Allowlist チェック → 未設定または不一致ならブロック
5. ApprovalToken 検証 → 無効ならブロック
6. Token-Draft マッチング → draft_id/tracking_id 不一致ならブロック
7. レート制限チェック → 日次上限超過ならブロック
8. PreSendGate チェック → PII/禁止表現/トラッキングタグ
9. Gmail API で送信
```

#### ブロック理由

| 理由 | 説明 |
|------|------|
| `not_in_registry` | 下書きがDraftRegistryに登録されていない |
| `not_enabled` | ENABLE_AUTO_SEND が true でない |
| `kill_switch` | KILL_SWITCH が true |
| `no_allowlist_configured` | Allowlist が未設定 |
| `allowlist` | 送信先が Allowlist に含まれていない |
| `rate_limit` | 日次送信上限に達した |
| `invalid_token` | ApprovalToken が無効または改竄されている |
| `token_draft_mismatch` | トークンの draft_id または tracking_id が不一致 |
| `gate_failed` | PreSendGate チェックに失敗 |

#### メトリクス記録

送信試行/成功/ブロックは自動的に `data/metrics.ndjson` に記録されます。

**記録される情報**:
- タイムスタンプ
- トラッキングID
- 企業ID
- テンプレートID
- A/Bバリアント
- ドラフトID
- 送信先ドメイン（フルメールアドレスではない、PII保護）
- ブロック理由（ブロック時）

**記録されない情報（PII禁止）**:
- 送信先のフルメールアドレス
- メール本文
- 候補者情報

#### 緊急停止手順

**方法1: RuntimeKillSwitch（推奨、即時反映）**

```bash
# 停止
npx ts-node src/cli/run_ops.ts stop-send \
  --reason "reply_rate drop" \
  --set-by "operator-name"

# 確認
npx ts-node src/cli/run_ops.ts stop-status

# 再開
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "issue resolved" \
  --set-by "operator-name"
```

**方法2: 環境変数（再起動が必要）**

```bash
# 1. .env に KILL_SWITCH=true を設定
echo "KILL_SWITCH=true" >> .env

# 2. または環境変数で設定
export KILL_SWITCH=true

# 3. 確認
npx ts-node src/cli/run_ops.ts send \
  --draft-id "any" \
  --to "any@any.com" \
  --approval-token "any"
# → "kill_switch" でブロックされることを確認
```

**キルスイッチの優先順位**:
1. 環境変数 `KILL_SWITCH=true` → 最優先でブロック（`kill_switch`）
2. RuntimeKillSwitch（`data/kill_switch.json`）→ 次にチェック（`runtime_kill_switch`）

#### stop-send サブコマンド

送信を緊急停止します（RuntimeKillSwitchを有効化）。

```bash
npx ts-node src/cli/run_ops.ts stop-send \
  --reason "reply_rate drop" \
  --set-by "operator-name"
```

**オプション**:

| オプション | 説明 | 必須 |
|------------|------|------|
| `--reason <reason>` | 停止理由 | ✓ |
| `--set-by <name>` | 操作者名/ID | ✓ |
| `--json` | JSON出力 | - |

**動作**:
- `data/kill_switch.json` を作成し、`enabled=true` を設定
- `OPS_STOP_SEND` メトリクスイベントを記録
- 以降の送信は `runtime_kill_switch` でブロック

#### resume-send サブコマンド

停止した送信を再開します（RuntimeKillSwitchを無効化）。

```bash
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "issue resolved" \
  --set-by "operator-name"
```

**オプション**:

| オプション | 説明 | 必須 |
|------------|------|------|
| `--reason <reason>` | 再開理由 | ✓ |
| `--set-by <name>` | 操作者名/ID | ✓ |
| `--json` | JSON出力 | - |

**動作**:
- `data/kill_switch.json` の `enabled=false` を設定
- `OPS_RESUME_SEND` メトリクスイベントを記録
- 送信ブロックが解除（他の条件を満たせば送信可能に）

#### stop-status サブコマンド

現在のキルスイッチと送信ポリシーの状態を確認します。

```bash
npx ts-node src/cli/run_ops.ts stop-status
```

**出力例**:

```
============================================================
Send Policy Status
============================================================

Overall Sending: DISABLED

Kill Switches:
  Environment (KILL_SWITCH): Inactive
  Runtime (file-based): ACTIVE (blocking)
    Reason: reply_rate drop
    Set by: operator-name
    Set at: 2026-01-26T10:00:00.000Z

Configuration:
  ENABLE_AUTO_SEND: true
  Allowlist Domains: 2
  Allowlist Emails: 1
  Max Per Day: 20
```

#### rollback サブコマンド

実験をロールバック（一時停止）し、オプションで送信も停止します。

```bash
# 実験のみロールバック
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "reply_rate急落" \
  --set-by "operator-name"

# 実験ロールバック + 送信停止
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "incident response" \
  --set-by "operator-name" \
  --stop-send

# ドライラン（変更なし）
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "test" \
  --set-by "tester" \
  --dry-run
```

**オプション**:

| オプション | 説明 | 必須 |
|------------|------|------|
| `--experiment <id>` | 実験ID | ✓ |
| `--reason <reason>` | ロールバック理由 | ✓ |
| `--set-by <name>` | 操作者名/ID | ✓ |
| `--stop-send` | 送信も停止（RuntimeKillSwitch有効化） | - |
| `--dry-run` | 変更なし、確認のみ | - |
| `--json` | JSON出力 | - |

**動作**:
- 実験の `status` を `paused` に変更
- 実験の `endAt` を現在時刻に設定
- `config/experiments.json` のバックアップを作成
- `--stop-send` 時は RuntimeKillSwitch も有効化
- `OPS_ROLLBACK` メトリクスイベントを記録

### 7.19 RuntimeKillSwitch（ファイルベース緊急停止）

`.env` を変更せずに、ファイルベースで送信を即座に停止できる機能です。

#### ファイル形式（data/kill_switch.json）

```json
{
  "enabled": true,
  "reason": "reply_rate drop",
  "set_by": "operator-name",
  "set_at": "2026-01-26T10:00:00.000Z"
}
```

#### 設計方針

- **ファイルが存在しない場合**: 送信許可（デフォルト）
- **`enabled=true`**: 送信停止
- **`enabled=false`**: 送信許可（停止解除）
- **ファイル読み込み失敗**: 安全側で停止（fail-safe）

#### CLI操作

```bash
# 停止
npx ts-node src/cli/run_ops.ts stop-send --reason "..." --set-by "..."

# 再開
npx ts-node src/cli/run_ops.ts resume-send --reason "..." --set-by "..."

# 状態確認
npx ts-node src/cli/run_ops.ts stop-status
```

#### 環境変数KILLSWITCHとの違い

| 項目 | 環境変数 (KILL_SWITCH) | RuntimeKillSwitch |
|------|------------------------|-------------------|
| 設定方法 | .env または export | CLI または ファイル編集 |
| 反映タイミング | プロセス再起動時 | 即時 |
| ブロック理由 | `kill_switch` | `runtime_kill_switch` |
| 優先度 | 高（先にチェック） | 低（後にチェック） |
| 操作ログ | なし | メトリクスに記録 |

**推奨**: 緊急時は `stop-send` CLIを使用（即時反映、操作ログあり）

### 7.20 実験ロールバック（rollback_experiment CLI）

問題が発生した実験を一時停止し、送信も停止できるCLIです。

#### 使用タイミング

- 返信率が急激に低下した場合
- メール内容に問題が発見された場合
- 外部要因で実験を中断する必要がある場合

#### 実行方法

```bash
# 実験のみ一時停止
npx ts-node src/cli/rollback_experiment.ts \
  --experiment "ab_subject_cta_v1" \
  --reason "返信率が2%を下回ったため" \
  --set-by "田中太郎"

# 実験停止 + 送信停止
npx ts-node src/cli/rollback_experiment.ts \
  --experiment "ab_subject_cta_v1" \
  --reason "緊急: 送信内容に問題発見" \
  --set-by "田中太郎" \
  --stop-send
```

#### 動作詳細

1. `config/experiments.json` のバックアップを `data/backups/` に作成
2. 対象実験の `status` を `paused` に変更
3. `endAt` を現在時刻に設定
4. `description` にロールバック記録を追記
5. `--stop-send` 時は RuntimeKillSwitch を有効化
6. `OPS_ROLLBACK` メトリクスイベントを記録

#### 復旧手順

```bash
# 1. 問題を解決

# 2. 送信を再開（--stop-send を使った場合）
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "問題解決、送信再開" \
  --set-by "田中太郎"

# 3. 実験を再開（experiments.json を編集）
# "status": "paused" → "status": "running"
# "endAt": null または将来の日時

# 4. 状態確認
npx ts-node src/cli/run_ops.ts status
```

### 7.21 段階リリース（RampPolicy）

自動送信を段階的に拡張するための機能です。日次キャップまたはパーセンテージモードで制御します。

#### 設定ファイル（config/auto_send.json）

```json
{
  "enabled": true,
  "mode": "daily_cap",
  "daily_cap_schedule": [
    { "date": "2026-01-26", "cap": 1 },
    { "date": "2026-01-27", "cap": 3 },
    { "date": "2026-01-28", "cap": 5 },
    { "date": "2026-01-29", "cap": 10 },
    { "date": "2026-01-30", "cap": 20 }
  ],
  "percentage": 0.05,
  "min_sent_before_increase": 50
}
```

#### 設定項目

| 項目 | 型 | 説明 | デフォルト |
|------|-----|------|-----------|
| `enabled` | boolean | 段階リリースを有効化 | true |
| `mode` | `daily_cap` \| `percentage` | 制御モード | `daily_cap` |
| `daily_cap_schedule` | array | 日付別の送信上限 | [] |
| `percentage` | number | パーセンテージモード時の割合（0-1） | 0.05 |
| `min_sent_before_increase` | number | 上限増加前の最小送信数 | 50 |

#### モード説明

**daily_cap モード**:
- 日付ごとに送信上限を設定
- スケジュールに載っていない日は、最も近い過去の日付の上限を使用
- スケジュール開始前はすべてブロック
- 段階的にキャップを増やすことで安全にロールアウト

**percentage モード**:
- 企業IDのハッシュ値に基づき、指定割合の企業のみ自動送信対象にする
- 同じ企業は常に同じ結果（安定割当）
- 例: `percentage: 0.1` で約10%の企業が対象

#### ramp-status サブコマンド

現在の段階リリース状況を確認します。

```bash
# テーブル出力
npx ts-node src/cli/run_ops.ts ramp-status

# JSON出力
npx ts-node src/cli/run_ops.ts ramp-status --json
```

**出力例**:

```
============================================================
Ramp Policy Status
============================================================

Enabled: Yes
Mode: daily_cap

Today:
  Sent: 3
  Cap: 5
  Can send more: Yes
  Remaining: 2

Daily Cap Schedule:
  2026-01-26: 1
  2026-01-27: 3
  2026-01-28: 5 <-- today
  2026-01-29: 10
  2026-01-30: 20
```

#### ブロック理由（ramp_limited）

段階リリース制限でブロックされた場合、`AUTO_SEND_BLOCKED` イベントに `reason: "ramp_limited"` が記録されます。

| 状況 | 詳細メッセージ |
|------|----------------|
| 日次上限到達 | `Daily cap reached: X/Y` |
| スケジュール開始前 | `Ramp schedule not started yet` |
| パーセンテージ除外 | `Company not in X% auto-send group` |

### 7.22 自動停止（AutoStopPolicy & AutoStopJob）

メトリクスを監視し、問題があれば自動的にRuntimeKillSwitchを有効化します。

#### 設定ファイル（config/auto_stop.json）

```json
{
  "window_days": 3,
  "min_sent_total": 30,
  "reply_rate_min": 0.015,
  "blocked_rate_max": 0.30,
  "consecutive_days": 2
}
```

#### 設定項目

| 項目 | 型 | 説明 | デフォルト |
|------|-----|------|-----------|
| `window_days` | number | 評価ウィンドウ（日数） | 3 |
| `min_sent_total` | number | 評価に必要な最小送信数 | 30 |
| `reply_rate_min` | number | 最小返信率（下回ると警告） | 0.015 (1.5%) |
| `blocked_rate_max` | number | 最大ブロック率（上回ると警告） | 0.30 (30%) |
| `consecutive_days` | number | 停止発動に必要な連続日数 | 2 |

#### 停止判定ロジック

1. **最小送信数チェック**: `totalSuccess >= min_sent_total` でなければ評価しない
2. **返信率チェック**: `reply_rate < reply_rate_min` で警告
3. **ブロック率チェック**: `blocked_rate > blocked_rate_max` で警告
4. **連続日数チェック**: 上記問題が `consecutive_days` 日連続で発生したら停止

**停止条件**: (返信率低下 OR ブロック率高い) AND 連続日数到達

#### auto-stop サブコマンド

自動停止評価を実行します。

```bash
# ドライラン（評価のみ、停止しない）
npx ts-node src/cli/run_ops.ts auto-stop

# 実際に停止を実行
npx ts-node src/cli/run_ops.ts auto-stop --execute

# JSON出力
npx ts-node src/cli/run_ops.ts auto-stop --json
```

**出力例**:

```
============================================================
Auto-Stop Evaluation
============================================================

Mode: DRY RUN
Window: 3 days

Metrics:
  Total Sent: 150
  Total Replies: 2
  Total Blocked: 10
  Reply Rate: 1.33%
  Blocked Rate: 6.3%
  Consecutive Bad Days: 2

Should Stop: YES
Reasons:
  - Reply rate too low: 1.33% (min: 1.5%)
  - 2 consecutive days with poor metrics (threshold: 2)

Action: WOULD STOP (dry run)
  Use --execute to actually stop sending.
```

#### 推奨運用

**日次ルーチンに追加**:

```bash
# 毎日実行（自動停止評価）
npx ts-node src/cli/run_ops.ts auto-stop --execute
```

**cronジョブ例**:

```cron
# 毎日9:00に自動停止評価
0 9 * * * cd /path/to/AI-Sales && npx ts-node src/cli/run_ops.ts auto-stop --execute >> /var/log/auto-stop.log 2>&1
```

#### 停止後の復旧手順

```bash
# 1. 停止状態を確認
npx ts-node src/cli/run_ops.ts stop-status

# 2. 原因を調査
npx ts-node src/cli/run_ops.ts report --since "$(date -v-7d +%Y-%m-%d)" --markdown

# 3. 問題を解決

# 4. 手動で再開
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "自動停止後の手動再開、原因調査完了" \
  --set-by "担当者名"
```

**重要**: 自動停止後の再開は常に人間が判断して `resume-send` を実行してください。自動再開は行われません。

### 7.23 運用イベント通知（Webhook）

運用上の重要イベントを外部Webhookに通知します（Slack Incoming Webhook互換）。

#### 設定

```bash
# .env に追加
NOTIFY_WEBHOOK_URL=https://hooks.slack.com/services/T00/B00/xxxx
```

**注意**: `NOTIFY_WEBHOOK_URL` が設定されていない場合、通知は送信されません（オプトイン設計）。

#### 通知イベントタイプ

| イベント | 重要度 | 発生タイミング |
|----------|--------|----------------|
| `AUTO_STOP_EXECUTED` | error | 自動停止が実行された時 |
| `OPS_STOP_SEND` | warn | `stop-send` コマンド実行時 |
| `OPS_RESUME_SEND` | info | `resume-send` コマンド実行時 |
| `OPS_ROLLBACK` | error | 実験ロールバック実行時 |
| `AUTO_SEND_SUCCESS` | info | 自動送信成功時 |
| `AUTO_SEND_BLOCKED` | warn | 自動送信ブロック時 |
| `SEND_APPROVED` | info | 送信承認時 |
| `RAMP_LIMITED` | info | 段階リリース制限でブロック時 |

#### PII保護

通知に含まれる情報は**PIIを含みません**：

**含まれる情報**:
- イベントタイプ、重要度、タイムスタンプ
- 識別子（tracking_id, company_id, experiment_id, template_id）
- 集計メトリクス（sent_3d, reply_3d, blocked_3d, reply_rate_3d）
- ブロック/停止理由

**含まれない情報（PII禁止）**:
- メールアドレス
- メール本文
- 候補者の経歴要約
- 企業名
- 候補者名

#### レート制限（spam防止）

同一タイプ+理由+企業の通知は**10分間**に1回に制限されます。

**例外（常に通知）**:
- `AUTO_STOP_EXECUTED`
- `OPS_STOP_SEND`
- `OPS_RESUME_SEND`
- `OPS_ROLLBACK`

#### notify-test サブコマンド

Webhook接続をテストします。

```bash
# テスト通知を送信
npx ts-node src/cli/run_ops.ts notify-test

# JSON出力
npx ts-node src/cli/run_ops.ts notify-test --json
```

**出力例**:

```
============================================================
Webhook Notification Test
============================================================

Webhook URL: https://hooks.slack.com/***
Status: ENABLED

Sending test notification...
Result: SUCCESS

Test notification sent successfully.
```

#### 通知失敗時の動作

- 通知失敗は**メイン処理を中断しません**（best effort）
- 失敗は `data/notify_failures.ndjson` にログされます
- シークレット（URL等）はエラーログでマスクされます

#### 失敗ログの確認

```bash
# 失敗ログを確認
cat data/notify_failures.ndjson | jq .
```

**出力例**:

```json
{
  "timestamp": "2026-01-26T10:00:00.000Z",
  "eventType": "AUTO_STOP_EXECUTED",
  "errorMessage": "Webhook returned status 500: ***",
  "attemptId": "1706270400000-abc123"
}
```

#### Slack通知のフォーマット例

```
🚨 [AUTO_STOP_EXECUTED]
Reason: Reply rate too low: 1.33% (min: 1.5%); 2 consecutive days with poor metrics
Metrics: sent_3d=150, reply_3d=2, blocked_3d=10, reply_rate_3d=1.3%
Time: 2026-01-26T10:00:00.000Z
```

### 7.24 インシデント管理（P4-6）

運用プレイブック（停止→記録→復旧判定→再開）をコード化し、事故対応を属人化させません。

#### インシデントの自動作成

以下のイベント発生時、自動的にインシデントが作成されます：

| トリガー | 作成元 | 重要度 | 自動アクション |
|----------|--------|--------|----------------|
| `AUTO_STOP` | AutoStopJob | error | runtime_kill_switch_enabled |
| `OPS_STOP_SEND` | stop-send | warn | runtime_kill_switch_enabled |
| `OPS_ROLLBACK` | rollback | error | experiment_paused, runtime_kill_switch_enabled（--stop-send時） |

#### インシデントの状態遷移

```
open → mitigated → closed
 │
 └── （既存のopen incidentがある場合）
      新しいトリガーはnoteとして追記
```

#### インシデント操作コマンド

```bash
# インシデント一覧
npx ts-node src/cli/run_ops.ts incident list

# オープン中のみ表示
npx ts-node src/cli/run_ops.ts incident list --status open

# JSON出力
npx ts-node src/cli/run_ops.ts incident list --json

# インシデント詳細
npx ts-node src/cli/run_ops.ts incident show <incident_id>

# ノート追加（調査メモ等）
npx ts-node src/cli/run_ops.ts incident note <incident_id> \
  --message "原因調査中。APIレスポンス遅延が原因と推定" \
  --actor "担当者名"

# インシデントクローズ
npx ts-node src/cli/run_ops.ts incident close <incident_id> \
  --actor "担当者名" \
  --reason "原因特定完了、設定修正済み"
```

#### resume-check サブコマンド

送信再開前の安全性チェックを実行します。

```bash
# 再開安全性チェック
npx ts-node src/cli/run_ops.ts resume-check

# JSON出力
npx ts-node src/cli/run_ops.ts resume-check --json
```

**出力例**:

```
============================================================
Resume Safety Check
============================================================

Status: BLOCKED
Blockers (must resolve):
  - RuntimeKillSwitch is ON: Auto-stop triggered

Warnings:
  - Open incident exists: INC-20260127-001 (Reply rate too low)

Check Results:
  ✗ runtimeKillSwitch: blocked
  ✓ envKillSwitch: ok
  ✓ autoSendEnabled: ok
  ✓ allowlistConfigured: ok
  ✗ cooldownPeriod: blocked (Auto-stop within 24h)
  ✓ replyRateRecovered: ok
  ✗ noOpenIncident: warning
```

#### ResumeGate チェック項目

| チェック | ブロッカー/警告 | 説明 |
|----------|-----------------|------|
| runtimeKillSwitch | blocker | RuntimeKillSwitchがON |
| envKillSwitch | blocker | KILL_SWITCH=true |
| autoSendEnabled | blocker | ENABLE_AUTO_SEND≠true |
| allowlistConfigured | blocker | 許可リスト未設定 |
| cooldownPeriod | blocker | 24時間以内のauto-stop |
| replyRateRecovered | warning | reply_rateがまだ閾値未満 |
| noOpenIncident | warning | openインシデントが存在 |

#### resume-send の強化

`resume-send` 実行時、自動的に ResumeGate チェックが実行されます。

```bash
# ブロッカーがあれば停止
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "調査完了" \
  --set-by "担当者名"

# 強制実行（ブロッカーを無視、理由必須）
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "調査完了" \
  --set-by "担当者名" \
  --force \
  --force-reason "緊急対応のため経営判断で強制再開"
```

**重要**: `--force` 使用時は `--force-reason` が必須です。強制理由はインシデントのnoteに自動記録されます。

#### インシデントライフサイクルの例

```bash
# 1. 自動停止発生 → インシデント自動作成
# (AutoStopJobが INC-20260127-001 を作成)

# 2. 状態確認
npx ts-node src/cli/run_ops.ts stop-status
npx ts-node src/cli/run_ops.ts incident show INC-20260127-001

# 3. 調査メモを追加
npx ts-node src/cli/run_ops.ts incident note INC-20260127-001 \
  --message "送信先リストに無効なドメインが混入していた" \
  --actor "taro"

# 4. 再開安全性チェック
npx ts-node src/cli/run_ops.ts resume-check

# 5. 問題解決後、再開
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "無効ドメイン除外完了" \
  --set-by "taro"

# 6. インシデントクローズ
npx ts-node src/cli/run_ops.ts incident close INC-20260127-001 \
  --actor "taro" \
  --reason "原因特定・対策実施完了"
```

#### インシデントデータ形式

インシデントは `data/incidents.ndjson` に保存されます（PIIを含まない）。

```json
{
  "incident_id": "INC-20260127-abc123",
  "created_at": "2026-01-27T10:00:00.000Z",
  "created_by": "auto_stop",
  "trigger_type": "AUTO_STOP",
  "severity": "error",
  "status": "open",
  "reason": "Reply rate too low: 1.2%",
  "snapshot": {
    "window_days": 3,
    "sent": 100,
    "replies": 1,
    "reply_rate": 0.01,
    "blocked": 5,
    "blocked_rate": 0.05,
    "ramp_cap_today": 20,
    "kill_switch_state": { "env": false, "runtime": true },
    "active_templates": ["tpl-1"]
  },
  "actions_taken": [
    { "timestamp": "2026-01-27T10:00:00.000Z", "action": "runtime_kill_switch_enabled", "actor": "auto_stop" }
  ],
  "notes": [],
  "updated_at": "2026-01-27T10:00:00.000Z"
}
```

**スナップショット内容**:
- `window_days`: 集計期間
- `sent`, `replies`, `blocked`: イベント数
- `reply_rate`, `blocked_rate`: レート
- `ramp_cap_today`: 当日の段階リリース上限
- `kill_switch_state`: 停止スイッチ状態
- `active_templates`: アクティブなテンプレートID

### 7.25 インシデントレポート（P4-7）

インシデントを原因カテゴリで可視化し、再発防止をデータで回します。

#### 原因カテゴリ（Root Cause Categories）

インシデントは以下のカテゴリに自動分類されます：

| カテゴリID | 名称 | 説明 |
|------------|------|------|
| `policy_config` | ポリシー設定問題 | allowlist未設定、ENABLE_AUTO_SEND=false、kill_switch_on |
| `ramp_limited` | 段階リリース制限 | ramp制限が原因で送れない |
| `auto_stop_triggered` | 自動停止発動 | 返信率低下/blocked率上昇による自動停止 |
| `content_gate_failed` | コンテンツゲート違反 | PII/禁止表現/長さ/トラッキング欠落 |
| `token_or_registry` | トークン/レジストリ問題 | not_in_registry, token_draft_mismatch, invalid_token |
| `gmail_api` | Gmail API エラー | rate_limit, auth_error, transient_error |
| `experiment_health` | 実験健全性問題 | experiment paused/ended, low_n 継続 |
| `unknown` | 分類不能 | 上記に該当しない |

#### カテゴリ設定ファイル

`config/incident_categories.json` でカテゴリ定義を管理：

```json
{
  "version": "1.0.0",
  "categories": [
    {
      "id": "auto_stop_triggered",
      "name_ja": "自動停止発動",
      "detection_rules": {
        "reason_keywords": ["reply rate", "Auto-stop"],
        "trigger_types": ["AUTO_STOP"],
        "actions_taken": ["runtime_kill_switch_enabled"]
      },
      "recommended_actions": [
        "run_ops report で送信統計を確認",
        "返信率低下の原因を調査"
      ]
    }
  ]
}
```

#### incidents-report コマンド

```bash
# 週次レポート生成（デフォルト7日間）
npx ts-node src/cli/run_ops.ts incidents-report

# 期間指定
npx ts-node src/cli/run_ops.ts incidents-report --since "2026-01-20"

# Markdown出力（ドキュメント用）
npx ts-node src/cli/run_ops.ts incidents-report --markdown

# JSON出力（スクリプト連携用）
npx ts-node src/cli/run_ops.ts incidents-report --json

# 通知付き（Webhook設定時）
npx ts-node src/cli/run_ops.ts incidents-report --notify
```

#### レポート内容

| セクション | 内容 |
|------------|------|
| Category Breakdown | カテゴリ別インシデント件数（Top10） |
| Severity Breakdown | 重要度別件数（error/warn/info） |
| Open Incidents | 未クローズのインシデント一覧 |
| Recommended Actions | カテゴリごとの推奨対策 |

#### 週次運用ルーチン

```bash
# 1. 週次レポート生成
npx ts-node src/cli/run_ops.ts incidents-report --since "$(date -v-7d +%Y-%m-%d)" --markdown > weekly_incident_report.md

# 2. Slack通知（オプション）
npx ts-node src/cli/run_ops.ts incidents-report --notify

# 3. オープンインシデントの確認
npx ts-node src/cli/run_ops.ts incident list --status open

# 4. 各インシデントの対処
npx ts-node src/cli/run_ops.ts incident show <incident_id>
```

#### 推奨対策の読み方

> **重要**: 推奨対策は「提案」であり、**自動修正は行われません**。

各カテゴリには推奨対策が定義されています：

| カテゴリ | 推奨対策例 |
|----------|-----------|
| `policy_config` | allowlist設定確認、ENABLE_AUTO_SEND確認、stop-status確認 |
| `auto_stop_triggered` | report確認、safety確認、rollback検討、ramp縮小 |
| `content_gate_failed` | TemplateQualityGate違反確認、テンプレ修正、再承認 |
| `experiment_health` | status --all確認、safety確認、期間延長/ロールバック判断 |

推奨対策に従って手動で対処し、インシデントをクローズしてください：

```bash
# 対処後、インシデントをクローズ
npx ts-node src/cli/run_ops.ts incident close <incident_id> \
  --actor "担当者名" \
  --reason "原因: XXX、対策: YYY を実施"
```

#### レポート出力例（Markdown）

```markdown
# Incident Report

**Period**: 2026-01-20 ~ 2026-01-27
**Total Incidents**: 5

## Category Breakdown

| Rank | Category | Count |
|------|----------|-------|
| 1 | 自動停止発動 | 3 |
| 2 | ポリシー設定問題 | 2 |

## Severity Breakdown

| Severity | Count |
|----------|-------|
| 🔴 error | 3 |
| 🟡 warn | 2 |

## Open Incidents

| ID | Days Open | Category | Reason |
|----|-----------|----------|--------|
| INC-123... | 2 | 自動停止発動 | Reply rate too low |

## Recommended Actions

> **Note**: These are recommendations only. No automatic fixes are applied.

### 自動停止発動

- run_ops report --since で送信統計を確認
- 返信率低下の原因を調査
```

### 7.26 再発防止提案（P4-8）

インシデントの原因カテゴリに応じて、再発防止の「対策案」を自動生成し提案として蓄積します。

> **重要**: 提案は自動適用されません。人間がレビューして手動で実装します。

#### 提案の優先度定義

| 優先度 | 説明 | 対応目安 |
|--------|------|----------|
| **P0** | 緊急対応が必要（自動停止等） | 当日中 |
| **P1** | 重要な改善が必要 | 1週間以内 |
| **P2** | 改善が望ましい | 次回スプリント |

#### fixes-propose コマンド

```bash
# 週次提案生成（デフォルト7日、Top3カテゴリ）
npx ts-node src/cli/run_ops.ts fixes-propose

# 期間・カテゴリ数指定
npx ts-node src/cli/run_ops.ts fixes-propose --since "2026-01-20" --top 5

# ドライラン（保存しない）
npx ts-node src/cli/run_ops.ts fixes-propose --dry-run

# 通知付き
npx ts-node src/cli/run_ops.ts fixes-propose --notify

# JSON出力
npx ts-node src/cli/run_ops.ts fixes-propose --json
```

#### fixes-list / fixes-show コマンド

```bash
# 提案一覧
npx ts-node src/cli/run_ops.ts fixes-list

# ステータスでフィルタ
npx ts-node src/cli/run_ops.ts fixes-list --status proposed

# 提案詳細
npx ts-node src/cli/run_ops.ts fixes-show <proposal_id>
```

#### 提案のステータス

| ステータス | 説明 |
|------------|------|
| `proposed` | 提案済み（レビュー待ち） |
| `accepted` | 承認済み（実装予定） |
| `rejected` | 却下（対応不要と判断） |
| `implemented` | 実装完了 |

#### 週次運用ルーチン

```bash
# 1. インシデントレポート確認
npx ts-node src/cli/run_ops.ts incidents-report --since "$(date -v-7d +%Y-%m-%d)"

# 2. 再発防止提案を生成
npx ts-node src/cli/run_ops.ts fixes-propose --since "$(date -v-7d +%Y-%m-%d)"

# 3. 提案一覧を確認
npx ts-node src/cli/run_ops.ts fixes-list --status proposed

# 4. 個別提案を確認・対応
npx ts-node src/cli/run_ops.ts fixes-show <proposal_id>
# (手順に従って対応を実施)
```

#### 提案内容の例

**[P0] [自動停止発動] 自動停止原因の調査と対策**

```
Recommended Steps:
  1. run_ops report --since で直近の送信統計を確認
  2. run_ops safety --experiment で実験の健全性を確認
  3. 返信率低下の原因を特定
  4. 必要に応じて run_ops rollback で問題のある実験を停止
  5. ramp cap を縮小して慎重に再開
  6. run_ops resume-send --reason "調査完了" で再開

Related Files: config/auto_stop.json, config/experiments.json
Related Commands: run_ops report, run_ops safety, run_ops rollback
```

#### 提案データ形式

提案は `data/fix_proposals.ndjson` に保存されます（PIIを含まない）。

```json
{
  "proposal_id": "FIX-20260127-a1b2c3d4",
  "created_at": "2026-01-27T10:00:00.000Z",
  "created_by": "auto",
  "source": {
    "report_since": "2026-01-20",
    "top_categories": ["auto_stop_triggered", "policy_config"]
  },
  "category_id": "auto_stop_triggered",
  "priority": "P0",
  "title": "[自動停止発動] 自動停止原因の調査と対策",
  "recommended_steps": ["Step 1...", "Step 2..."],
  "related_artifacts": {
    "files": ["config/auto_stop.json"],
    "commands": ["run_ops report"]
  },
  "status": "proposed",
  "rationale": {
    "incident_count": 3,
    "recent_examples": ["INC-001", "INC-002"]
  }
}
```

#### 重複排除

同一カテゴリで直近7日以内に `proposed` または `accepted` ステータスの提案が存在する場合、新しい提案は生成されません。これにより重複した提案の氾濫を防ぎます。

### 7.27 提案の状態遷移管理（P4-9）

提案を承認・却下・実装済みに遷移させ、改善の実行管理を行います。

> **重要**: 状態はイベントのリプレイで算出されます。提案本体は不変で、状態変更はイベントとして追記されます。

#### 状態遷移図

```
proposed → ACCEPT → accepted → IMPLEMENT → implemented
    ↓
  REJECT
    ↓
 rejected
```

#### 状態の定義

| ステータス | 説明 | 意味 |
|------------|------|------|
| `proposed` | 提案済み | レビュー待ち状態 |
| `accepted` | 承認済み | 実装タスク化された状態（チケット作成済み等） |
| `rejected` | 却下 | 対応不要と判断された状態（理由必須） |
| `implemented` | 実装完了 | 対策が反映された状態（PR/commit等で確認可能） |

#### 不正な遷移（禁止）

- `rejected` → `ACCEPT` / `IMPLEMENT` : 却下済みの提案は承認・実装不可
- `implemented` → `ACCEPT` / `REJECT` : 実装済みの提案は再承認・却下不可
- `accepted` → `REJECT` : 承認済みの提案は却下不可（原則）
- `proposed` → `IMPLEMENT` : 承認されていない提案は実装済みにできない

#### fixes-accept コマンド（承認）

```bash
# 基本形
npx ts-node src/cli/run_ops.ts fixes-accept <proposal_id> \
  --actor "tanaka" \
  --reason "対応が必要と判断"

# チケット連携
npx ts-node src/cli/run_ops.ts fixes-accept <proposal_id> \
  --actor "tanaka" \
  --reason "JIRAチケット作成" \
  --ticket "JIRA-123"

# 通知付き
npx ts-node src/cli/run_ops.ts fixes-accept <proposal_id> \
  --actor "tanaka" \
  --reason "承認" \
  --notify
```

#### fixes-reject コマンド（却下）

```bash
# 理由は必須
npx ts-node src/cli/run_ops.ts fixes-reject <proposal_id> \
  --actor "suzuki" \
  --reason "現在の設定は意図的なもの（プロダクトチーム確認済み）"

# 通知付き
npx ts-node src/cli/run_ops.ts fixes-reject <proposal_id> \
  --actor "suzuki" \
  --reason "別の対策で対応済み" \
  --notify
```

#### fixes-implement コマンド（実装完了）

```bash
# 基本形（承認済みの提案のみ可能）
npx ts-node src/cli/run_ops.ts fixes-implement <proposal_id> \
  --actor "yamada" \
  --reason "auto_stopの閾値を調整"

# PR/commit連携
npx ts-node src/cli/run_ops.ts fixes-implement <proposal_id> \
  --actor "yamada" \
  --reason "閾値調整、本番反映済み" \
  --pr "#456" \
  --commit "abc123def"

# チケット・PR・commit全部
npx ts-node src/cli/run_ops.ts fixes-implement <proposal_id> \
  --actor "yamada" \
  --reason "対策完了" \
  --ticket "JIRA-123" \
  --pr "#456" \
  --commit "abc123def" \
  --notify
```

#### fixes-note コマンド（メモ追加）

```bash
# 状態を変えずにメモを追加（どの状態でも可能）
npx ts-node src/cli/run_ops.ts fixes-note <proposal_id> \
  --actor "tanaka" \
  --note "週次ミーティングで議論、来週対応予定"
```

#### fixes-show（履歴付き詳細表示）

```bash
# イベント履歴を含む詳細表示
npx ts-node src/cli/run_ops.ts fixes-show <proposal_id>

# 出力例:
# ID: FIX-20260127-a1b2c3d4
# Status: IMPLEMENTED
# ...
# Event History:
#   ✅ [2026-01-27T10:00:00Z] ACCEPT by tanaka
#      対応が必要と判断
#      Links: ticket=JIRA-123
#   📝 [2026-01-28T09:00:00Z] NOTE by yamada
#      実装開始
#   ✨ [2026-01-29T14:00:00Z] IMPLEMENT by yamada
#      閾値調整完了
#      Links: PR=#456, commit=abc123def
```

#### fixes-list（状態フィルタ）

```bash
# 承認待ち（proposed）の提案一覧
npx ts-node src/cli/run_ops.ts fixes-list --status proposed

# 実装待ち（accepted）の提案一覧
npx ts-node src/cli/run_ops.ts fixes-list --status accepted

# 実装済み（implemented）の提案一覧
npx ts-node src/cli/run_ops.ts fixes-list --status implemented
```

#### 週次運用ルーチン（完全版）

```bash
# 1. インシデントレポート確認
npx ts-node src/cli/run_ops.ts incidents-report --since "$(date -v-7d +%Y-%m-%d)"

# 2. 再発防止提案を生成
npx ts-node src/cli/run_ops.ts fixes-propose --since "$(date -v-7d +%Y-%m-%d)"

# 3. 提案一覧を確認（レビュー）
npx ts-node src/cli/run_ops.ts fixes-list --status proposed

# 4. 個別提案を確認
npx ts-node src/cli/run_ops.ts fixes-show <proposal_id>

# 5. 承認または却下
npx ts-node src/cli/run_ops.ts fixes-accept <proposal_id> --actor "..." --reason "..."
# または
npx ts-node src/cli/run_ops.ts fixes-reject <proposal_id> --actor "..." --reason "..."

# 6. 実装待ち提案を確認
npx ts-node src/cli/run_ops.ts fixes-list --status accepted

# 7. 実装完了を記録
npx ts-node src/cli/run_ops.ts fixes-implement <proposal_id> \
  --actor "..." --reason "..." --pr "..." --commit "..."
```

#### イベントデータ形式

イベントは `data/fix_proposal_events.ndjson` に追記されます（PIIを含まない）。

```json
{
  "event_id": "uuid-xxx",
  "timestamp": "2026-01-27T10:00:00.000Z",
  "proposal_id": "FIX-20260127-a1b2c3d4",
  "action": "ACCEPT",
  "actor": "tanaka",
  "reason": "対応が必要と判断",
  "links": {
    "ticket": "JIRA-123"
  }
}
```

#### 通知イベント

以下のイベントタイプで通知が送信されます（--notify オプション指定時）：

| イベント | 説明 |
|----------|------|
| `FIX_PROPOSAL_ACCEPTED` | 提案が承認された |
| `FIX_PROPOSAL_REJECTED` | 提案が却下された |
| `FIX_PROPOSAL_IMPLEMENTED` | 提案が実装完了になった |

#### 票が割れた場合の運用

提案の承認・却下で意見が分かれた場合：

1. **NOTE でディスカッション記録**: `fixes-note` で各意見を記録
2. **理由を明確に**: 最終決定時は `--reason` に根拠を詳しく記載
3. **エスカレーション**: P0提案で意見が割れた場合は上位者に判断を仰ぐ

### 7.17 推奨送信ワークフロー

下書き作成から送信までの推奨フローです。

```
run_one_company（下書き作成）
    ↓
  DraftRegistryに自動登録
    ↓
run_ops approve-send --dry-run（承認確認）
    ↓
  内容確認・送信可能性確認
    ↓
run_ops approve-send --execute（承認→送信）
    ↓
  SEND_APPROVED + AUTO_SEND_SUCCESS 記録
```

#### 具体的なコマンド

```bash
# Step 1: 下書き作成
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡"
# → draftId が出力される

# Step 2: 承認確認（ドライラン）
npx ts-node src/cli/run_ops.ts approve-send \
  --draft-id "<出力されたdraftId>" \
  --approved-by "承認者名" \
  --reason "南部パイロット" \
  --to "user@allowed-domain.com"
# → 承認トークンと送信可能性が表示される

# Step 3: 承認→送信（実行）
npx ts-node src/cli/run_ops.ts approve-send \
  --draft-id "<draftId>" \
  --approved-by "承認者名" \
  --reason "南部パイロット" \
  --to "user@allowed-domain.com" \
  --execute
# → 承認ログ記録 + メール送信
```

#### 重要な制約

1. **DraftRegistry必須**: `run_one_company` で作成された下書きのみ送信可能
2. **tracking_id紐付け**: 承認トークンの `tracking_id` と DraftRegistry の `tracking_id` が一致すること
3. **PII保存禁止**: 宛先はドメインのみ記録（フルメールアドレスは保存しない）
4. **監査ログ**: 承認/送信の全履歴が `data/approvals.ndjson` と `data/metrics.ndjson` に記録される

### 7.18 実験安全性チェック（ExperimentSafetyCheck）

実験の健全性をチェックし、凍結/ロールバックを**推奨**します。

**重要**: このチェックは推奨のみを行い、自動的な変更は行いません。

#### 安全性アクション

| アクション | 意味 | トリガー条件 |
|------------|------|--------------|
| `ok` | 問題なし | 全チェックパス |
| `freeze_recommended` | 凍結推奨 | 低サンプル（freezeOnLowN=true時） |
| `rollback_recommended` | ロールバック推奨 | 低返信率、長期間返信なし |
| `review_recommended` | レビュー推奨 | その他の注意事項あり |

#### チェック項目

1. **低返信率**: 返信率が `rollbackRule.minReplyRate` 未満（送信数が `minSentTotal` 以上の場合）
2. **長期間返信なし**: 最後の返信から `rollbackRule.maxDaysNoReply` 日以上経過
3. **低サンプル**: 一定期間経過後も送信数が `minSentTotal` 未満（`freezeOnLowN=true` の場合のみ）

#### 出力例

```json
{
  "experimentId": "ab_subject_cta_v1",
  "action": "rollback_recommended",
  "reasons": [
    "低返信率: 1.5% (閾値: 2%)",
    "長期間返信なし: 10日間"
  ],
  "metrics": {
    "totalSent": 150,
    "totalReplies": 2,
    "replyRate": 0.0133,
    "daysSinceLastReply": 10
  }
}
```

#### 対処方法

| アクション | 対処 |
|------------|------|
| `freeze_recommended` | 実験を一時停止し、サンプル蓄積を待つか、終了判断 |
| `rollback_recommended` | 実験を終了し、前のテンプレートに戻す検討 |
| `review_recommended` | 詳細を確認し、必要に応じて対処 |

### 7.28 送信キュー（SendQueue）

Gmail API の一時障害（429/5xx）への耐性を高めるため、送信をキューイング＋バックオフで安定化します。

#### 設計原則

1. **デフォルトはキュー追加**: `send_draft` CLI はデフォルトでキューに追加（`--execute` で即時送信）
2. **冪等性**: 同じ draft の二重送信を防止
3. **リトライ可能エラー**: 429/5xx は指数バックオフでリトライ
4. **dead_letter**: max_attempts 超過またはauth/policyエラーは人間確認用に分離
5. **PII禁止**: キューにメールアドレス・本文は保存しない（`to_domain` のみ）

#### データファイル（data/send_queue.ndjson）

```json
{
  "job_id": "SND-abc123def456",
  "created_at": "2026-01-27T10:00:00.000Z",
  "status": "queued",
  "draft_id": "draft-xxx",
  "tracking_id": "track-abc",
  "company_id": "company-xyz",
  "template_id": "template-001",
  "ab_variant": "A",
  "to_domain": "example.com",
  "approval_fingerprint": "a1b2c3d4",
  "attempts": 0,
  "next_attempt_at": "2026-01-27T10:00:00.000Z",
  "last_updated_at": "2026-01-27T10:00:00.000Z"
}
```

**フィールド説明**:

| フィールド | 説明 |
|------------|------|
| `job_id` | ジョブID（SND-で始まる） |
| `status` | `queued`, `in_progress`, `sent`, `failed`, `dead_letter`, `cancelled` |
| `draft_id` | Gmail下書きID |
| `tracking_id` | トラッキングID |
| `to_domain` | 送信先ドメイン（PIIを含まない） |
| `approval_fingerprint` | 承認トークンのSHA256ハッシュ先頭8文字 |
| `attempts` | 試行回数 |
| `next_attempt_at` | 次回試行予定時刻 |
| `last_error_code` | 最後のエラーコード |

#### ジョブステータス

| ステータス | 説明 | 処理 |
|------------|------|------|
| `queued` | キュー待機中 | process_send_queue で処理 |
| `in_progress` | 処理中 | リース中 |
| `sent` | 送信完了 | 終了状態 |
| `failed` | 失敗（リトライ不可） | policy/gate 問題 |
| `dead_letter` | 人間確認必要 | max_attempts超過、auth問題 |
| `cancelled` | キャンセル済み | 手動キャンセル |

#### エラー分類とリトライ

| エラーコード | HTTP | Retryable | Dead Letter |
|--------------|------|-----------|-------------|
| `gmail_429` | 429 | Yes | max attempts時 |
| `gmail_5xx` | 500-599 | Yes | max attempts時 |
| `gmail_400` | 400 | No | No |
| `auth` | 401/403 | No | Yes |
| `policy` | - | No | No |
| `gate` | - | No | No |
| `not_found` | 404 | No | Yes |
| `unknown` | - | Yes | max attempts時 |

#### バックオフ設定（config/retry_policy.json）

```json
{
  "maxAttempts": 5,
  "baseBackoffSeconds": 60,
  "maxBackoffSeconds": 3600,
  "backoffMultiplier": 3,
  "jitterFactor": 0.2
}
```

**バックオフ計算例**:
- Attempt 1失敗: 60秒後にリトライ
- Attempt 2失敗: 180秒後にリトライ
- Attempt 3失敗: 540秒後にリトライ
- Attempt 4失敗: 1620秒後にリトライ
- Attempt 5失敗: dead_letter に移行

#### send_draft CLI の変更

```bash
# デフォルト: キューに追加
npx ts-node src/cli/send_draft.ts \
  --draft-id "draft-123" \
  --to "user@example.com" \
  --approval-token "..."
# → queued: job_id=SND-xxx

# 即時送信（--execute）
npx ts-node src/cli/send_draft.ts \
  --draft-id "draft-123" \
  --to "user@example.com" \
  --approval-token "..." \
  --execute
# → sent: message_id=xxx
```

#### process_send_queue CLI

キューを処理するワーカーです。

```bash
# ドライラン（送信しない）
npx ts-node src/cli/process_send_queue.ts --max-jobs 10

# 実際に送信
npx ts-node src/cli/process_send_queue.ts --max-jobs 10 --execute

# JSON出力
npx ts-node src/cli/process_send_queue.ts --max-jobs 10 --execute --json
```

**オプション**:

| オプション | 説明 | デフォルト |
|------------|------|-----------|
| `--max-jobs <n>` | 最大処理件数 | 10 |
| `--execute` | 実際に送信 | - |
| `--json` | JSON出力 | - |

#### run_ops send-queue サブコマンド

```bash
# キュー状態確認
npx ts-node src/cli/run_ops.ts send-queue status

# キュー処理（ドライラン）
npx ts-node src/cli/run_ops.ts send-queue process --max-jobs 5

# キュー処理（実行）
npx ts-node src/cli/run_ops.ts send-queue process --max-jobs 5 --execute

# dead letter 一覧
npx ts-node src/cli/run_ops.ts send-queue dead-letter

# dead letter 詳細
npx ts-node src/cli/run_ops.ts send-queue dead-letter --job-id SND-xxx

# dead letter リトライ
npx ts-node src/cli/run_ops.ts send-queue retry --job-id SND-xxx --actor "operator" --reason "Auth fixed"
```

#### 通知イベント

| イベント | 重要度 | 発生タイミング |
|----------|--------|----------------|
| `SEND_QUEUE_DEAD_LETTER` | error | dead_letterに移行時 |
| `SEND_QUEUE_BACKOFF` | warn | バックオフ開始時 |

#### 日次運用ルーチン

```bash
# 1. キュー状態確認
npx ts-node src/cli/run_ops.ts send-queue status

# 2. キュー処理（10件まで）
npx ts-node src/cli/run_ops.ts send-queue process --max-jobs 10 --execute

# 3. dead letter 確認
npx ts-node src/cli/run_ops.ts send-queue dead-letter

# 4. 問題がある場合は調査して retry
npx ts-node src/cli/run_ops.ts send-queue retry --job-id SND-xxx --actor "..." --reason "..."
```

#### cronジョブ例

```cron
# 5分ごとにキュー処理
*/5 * * * * cd /path/to/AI-Sales && npx ts-node src/cli/process_send_queue.ts --max-jobs 5 --execute >> /var/log/send_queue.log 2>&1
```

#### dead letter の対処

1. **エラー確認**: `send-queue dead-letter --job-id SND-xxx` で詳細確認
2. **原因特定**:
   - `auth`: 認証情報の期限切れ → 認証再設定
   - `gmail_429`: 継続的なレート制限 → 送信量削減
   - `not_found`: 下書き削除 → キャンセル
3. **対処実行**: 原因解決後、`send-queue retry` で再キュー
4. **キャンセル**: 対処不能な場合は手動でキャンセル

---

## 8. 運用ルーチン

### 8.1 日次ルーチン（毎日）

```bash
# 1. Gmail送信/返信スキャン（前日分）
npx ts-node src/cli/run_ops.ts scan --since "$(date -v-1d +%Y-%m-%d)"

# 2. 簡易レポート確認
npx ts-node src/cli/run_ops.ts report --since "$(date -v-7d +%Y-%m-%d)"

# 3. 安全性チェック
npx ts-node src/cli/run_ops.ts safety
```

**確認ポイント**:
- 送信/返信が正常に検出されているか
- 返信率が異常に低くないか
- 安全性チェックで警告がないか

### 8.2 週次ルーチン（週1回）

```bash
# 1. 詳細レポート（Markdown出力）
npx ts-node src/cli/run_ops.ts report --since "$(date -v-14d +%Y-%m-%d)" --markdown --include-decision > weekly_report.md

# 2. セグメント別レポート
npx ts-node src/cli/report_segment_metrics.ts --since "$(date -v-14d +%Y-%m-%d)" --markdown --include-decision >> weekly_report.md

# 3. 改善提案生成（ドライラン）
npx ts-node src/cli/run_ops.ts propose --experiment "ab_subject_cta_v1" --since "$(date -v-14d +%Y-%m-%d)" --dry-run

# 4. 提案内容レビュー後、実行
npx ts-node src/cli/run_ops.ts propose --experiment "ab_subject_cta_v1" --since "$(date -v-14d +%Y-%m-%d)"

# 5. 提案されたテンプレートを承認（人間判断後）
npx ts-node src/cli/run_ops.ts approve \
  --experiment "ab_subject_cta_v1" \
  --template-id "<提案されたID>" \
  --approved-by "承認者名" \
  --reason "承認理由"
```

**確認ポイント**:
- A/Bテストの勝者判定が可能か
- セグメント別に改善余地があるか
- 提案されたテンプレートの内容が適切か

### 8.3 月次/終了時ルーチン

```bash
# 1. 勝者判定（ドライラン）
npx ts-node src/cli/run_ops.ts promote --experiment "ab_subject_cta_v1" --dry-run

# 2. 判定結果確認後、昇格実行
npx ts-node src/cli/run_ops.ts promote --experiment "ab_subject_cta_v1"

# 3. 実験ステータス確認
npx ts-node src/cli/run_ops.ts status --all
```

**確認ポイント**:
- 統計的有意差が出ているか
- 最小リフト（minLift）を超えているか
- 昇格後は新しい実験を設計するか検討

### 8.4 緊急時対応

#### 全送信を即座に停止する場合

```bash
# RuntimeKillSwitch で即時停止（推奨）
npx ts-node src/cli/run_ops.ts stop-send \
  --reason "問題発生のため緊急停止" \
  --set-by "担当者名"

# 状態確認
npx ts-node src/cli/run_ops.ts stop-status

# 問題解決後に再開
npx ts-node src/cli/run_ops.ts resume-send \
  --reason "問題解決のため再開" \
  --set-by "担当者名"
```

#### 返信率が急落した場合

```bash
# 1. 安全性チェック
npx ts-node src/cli/run_ops.ts safety --experiment "ab_subject_cta_v1"

# 2. rollback_recommended の場合 → 実験ロールバック
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "返信率急落のため" \
  --set-by "担当者名"

# 3. 送信も含めて緊急停止する場合
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "返信率急落のため" \
  --set-by "担当者名" \
  --stop-send
```

#### 実験を一時停止する場合

```bash
# CLI で実行（推奨）
npx ts-node src/cli/run_ops.ts rollback \
  --experiment "ab_subject_cta_v1" \
  --reason "調査のため一時停止" \
  --set-by "担当者名"

# または experiments.json を手動編集
# "status": "running" → "status": "paused"
```

#### 実験を終了する場合

```bash
# experiments.json を編集
# "status": "running" → "status": "ended"
# "endDate": "2026-01-26"
```

#### 緊急時対応チェックリスト

1. [ ] `stop-status` で現在の状態を確認
2. [ ] 必要に応じて `stop-send` で送信停止
3. [ ] 問題の実験を特定し `safety` でチェック
4. [ ] 必要に応じて `rollback` で実験停止
5. [ ] 原因調査
6. [ ] 問題解決後、`resume-send` で送信再開
7. [ ] 必要に応じて experiments.json を編集して実験再開

---

## 9. 連絡先

問題が解決しない場合は、以下を確認してください：

1. `docs/system_map.md` - システム構成と API 仕様
2. `docs/candidate_api.md` - 候補者API仕様
3. CRM 管理者に確認

---

## 更新履歴

| 日付 | 更新内容 |
|------|----------|
| 2026-01-26 | 初版作成 |
| 2026-01-26 | B案仕様追加（候補者経歴要約）、監査ログ、run_daily_queue CLI |
| 2026-01-26 | P3-1: トラッキングID、A/Bテンプレート運用追加 |
| 2026-01-26 | P3-2: Gmail送信/返信スキャン、A/Bメトリクスレポート追加 |
| 2026-01-26 | P3-3: A/B勝者判定（z検定）、昇格機能、experiments.json追加 |
| 2026-01-26 | P3-4: セグメント別メトリクス、segments.json、探索的A/B判定追加 |
| 2026-01-26 | P3-5: テンプレート改善提案自動生成（ImprovementPicker, TemplateGenerator, propose_templates CLI） |
| 2026-01-26 | P3-6: テンプレート承認ワークフロー（TemplateQualityGate, approve_templates CLI, 承認ログ） |
| 2026-01-26 | P3-7: 実験ライフサイクル管理（status, startAt, endAt, rollbackRule, ExperimentScheduler, ExperimentSafetyCheck, run_ops CLI, 日次/週次ルーチン） |
| 2026-01-26 | P4-1: 自動送信（限定パイロット）- SendPolicy, PreSendGate, send_draft CLI, AUTO_SEND_* メトリクス、緊急停止機能 |
| 2026-01-26 | P4-2: 承認→送信ワンコマンド化 - DraftRegistry, approve_send CLI, approve-send サブコマンド、tracking_id紐付け強制 |
| 2026-01-26 | P4-3: 緊急停止とロールバック - RuntimeKillSwitch, stop-send/resume-send/stop-status/rollback サブコマンド, rollback_experiment CLI, OPS_STOP_SEND/OPS_RESUME_SEND/OPS_ROLLBACK メトリクス |
| 2026-01-26 | P4-4: 段階リリースと自動停止 - RampPolicy, AutoStopPolicy, AutoStopJob, ramp-status/auto-stop サブコマンド, ramp_limited ブロック理由追加 |
| 2026-01-26 | P4-5: 運用イベント通知 - WebhookNotifier, NotificationRouter, notify-test サブコマンド, PII-free通知設計 |
| 2026-01-27 | P4-10: 送信キュー - SendQueueStore, RetryPolicy, SendQueueManager, process_send_queue CLI, send_draft enqueue デフォルト化, send-queue サブコマンド |
