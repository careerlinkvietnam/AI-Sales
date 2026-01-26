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
2. **Candidate Stub Mode**: 現在は常にスタブ候補者を返します（API連携は今後実装）
3. **Dry Run Mode**: `--dry-run` でメール内容を確認できます

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

## 6. 連絡先

問題が解決しない場合は、以下を確認してください：

1. `docs/system_map.md` - システム構成と API 仕様
2. CRM 管理者に確認

---

## 更新履歴

| 日付 | 更新内容 |
|------|----------|
| 2026-01-26 | 初版作成 |
