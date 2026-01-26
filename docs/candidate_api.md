# Candidate Search API 仕様書

## 概要

候補者検索API（Candidate Search API）は、企業プロファイルに基づいて適切な候補者を検索するためのインターフェースを提供します。

## モード

| モード | 環境変数 | 説明 |
|--------|----------|------|
| `stub` | `CANDIDATE_MODE=stub` または未設定 | テスト用ダミーデータを返す |
| `real` | `CANDIDATE_MODE=real` | 実APIに接続 |

## 環境変数

```bash
# モード切替（デフォルト: stub）
CANDIDATE_MODE=stub

# realモード時に必須
CANDIDATE_API_URL=https://api.example.com/candidates
CANDIDATE_API_KEY=your-api-key-here
```

## インターフェース

### ICandidateClient

```typescript
interface ICandidateClient {
  searchCandidates(
    profile: CompanyProfile,
    options?: CandidateSearchOptions
  ): Promise<CandidateSearchResult>;

  validateRationale(candidate: Candidate): boolean;
  isStubMode(): boolean;
  getMode(): 'stub' | 'real';
}
```

### CandidateSearchOptions

```typescript
interface CandidateSearchOptions {
  limit?: number;        // 最大取得件数
  region?: string;       // 地域フィルタ
  industryHint?: string; // 業界ヒント
}
```

### CandidateSearchResult

```typescript
interface CandidateSearchResult {
  candidates: Candidate[];
  totalFound: number;
  searchCriteria: {
    companyId: string;
    region?: string;
    industryHint?: string;
  };
  mode: 'stub' | 'real';
}
```

## 使用方法

### 基本使用

```typescript
import { createCandidateClient } from '../connectors/candidate';

const client = createCandidateClient();
const result = await client.searchCandidates(companyProfile);
console.log(`Found ${result.candidates.length} candidates (${result.mode} mode)`);
```

### オプション指定

```typescript
const result = await client.searchCandidates(companyProfile, {
  limit: 5,
  region: '南部',
  industryHint: '製造業'
});
```

### モード強制指定

```typescript
// テスト時にスタブを強制
const stubClient = createCandidateClient({ mode: 'stub' });

// 本番APIを強制
const realClient = createCandidateClient({
  mode: 'real',
  apiUrl: 'https://api.example.com',
  apiKey: 'secret'
});
```

## Rationale 検証

候補者の `rationale` フィールドは、なぜその候補者が企業にマッチするかを説明します。

### 有効な reasonTags

| タグ | 説明 |
|------|------|
| `勤務地一致` | 勤務地が企業の所在地と一致 |
| `業界近似` | 業界が近い |
| `業界経験一致` | 業界での経験がある |
| `職種一致` | 職種が一致 |
| `日本語可` | 日本語が使用可能 |
| `言語スキル` | 言語スキルが適合 |
| `マネジメント経験` | マネジメント経験あり |
| `即戦力` | 即戦力として期待できる |
| `営業経験` | 営業経験あり |
| `日系企業理解` | 日系企業での経験/理解 |
| `技術スキル一致` | 技術スキルが一致 |

### 有効な evidenceFields パターン

| パターン | 説明 |
|----------|------|
| `company.location.region` | 企業の地域 |
| `company.location.province` | 企業の県/省 |
| `company.industryText` | 企業の業界テキスト |
| `company.tags` | 企業のタグ |
| `company.companyId` | 企業ID（参照用） |
| `company.profile` | 企業プロファイル |

### 検証例

```typescript
import { validateCandidateRationale } from '../connectors/candidate';

const result = validateCandidateRationale(candidate);
if (!result.valid) {
  console.log('Invalid reason tags:', result.invalidReasonTags);
  console.log('Invalid evidence fields:', result.invalidEvidenceFields);
}
```

## Real API 仕様

### エンドポイント

```
POST {CANDIDATE_API_URL}/search
```

### リクエスト

```json
{
  "companyProfile": {
    "companyId": "string",
    "companyName": "string",
    "region": "string",
    "industryText": "string",
    "tags": ["string"]
  },
  "limit": 10
}
```

### レスポンス

```json
{
  "candidates": [
    {
      "candidateId": "C001",
      "headline": "製造業経験10年のプロダクションマネージャー",
      "keySkills": ["生産管理", "品質管理"],
      "location": "南部",
      "availability": "即日可能",
      "rationale": {
        "reasonTags": ["業界経験一致", "勤務地一致"],
        "evidenceFields": ["company.industryText", "company.location.region"]
      }
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 10
}
```

### エラーレスポンス

| ステータス | 説明 |
|------------|------|
| 400 | リクエスト不正 |
| 401 | 認証エラー |
| 500 | サーバーエラー |

## 制約事項

1. **rationale検証**: `reasonTags` または `evidenceFields` が不正な候補者は自動的に除外されます
2. **PII保護**: ログ出力時に候補者IDはマスクされます
3. **タイムアウト**: デフォルト30秒（設定可能）

## スタブモードのデータ

スタブモードでは以下の3名のダミー候補者が返されます：

| ID | 概要 | 地域 |
|----|------|------|
| C001 | 製造業経験10年のプロダクションマネージャー | 南部 |
| C002 | IT企業出身のプロジェクトマネージャー | 南部 |
| C003 | 営業経験5年の日系企業担当 | 南部 |

企業プロファイルの `region` に応じて `勤務地一致` タグが自動調整されます。
