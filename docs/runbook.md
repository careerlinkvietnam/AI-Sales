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

### 7.14 実験安全性チェック（ExperimentSafetyCheck）

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

**返信率が急落した場合**:

```bash
# 1. 安全性チェック
npx ts-node src/cli/run_ops.ts safety --experiment "ab_subject_cta_v1"

# 2. rollback_recommended の場合
# → experiments.json の status を "paused" に変更
# → 原因調査後、終了または再開を判断
```

**実験を一時停止する場合**:

```bash
# experiments.json を編集
# "status": "running" → "status": "paused"
```

**実験を終了する場合**:

```bash
# experiments.json を編集
# "status": "running" → "status": "ended"
# "endDate": "2026-01-26"
```

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
