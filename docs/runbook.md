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

---

## 8. 連絡先

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
