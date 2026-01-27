# AI-Sales セッション引き継ぎドキュメント

最終更新: 2026-01-27

---

## プロジェクト概要

**AI-Sales** は CareerLink CRM と連携した営業自動化システムです。

- **目的**: タグベースで企業を検索 → 候補者推薦 → メール下書き作成 → 安全な送信管理
- **言語**: TypeScript (Node.js)
- **データ**: NDJSON形式（DBレス）
- **制約**: PII禁止、Gmail送信(send)禁止（draftのみ）、自動承認禁止

---

## 実装状況 (2026-01-27時点)

| Phase | 内容 | 状態 |
|-------|------|------|
| P0 | CRM接続基盤 | ✅ 完了 |
| P1 | 営業パイプライン（タグ→候補者→メール下書き） | ✅ 完了 |
| P2 | CandidateClient + PriorityScorer | ✅ 完了 |
| P3-1〜P3-7 | A/Bテスト基盤・実験管理 | ✅ 完了 |
| P4-1〜P4-16 | 運用自動化・安全機構 | ✅ 完了 |

**全フェーズ実装完了**。テスト64ファイル、ソース81ファイル。

---

## ディレクトリ構成

```
AI-Sales/
├── src/
│   ├── cli/           # 21 CLIコマンド
│   ├── connectors/    # CRM, Gmail, Candidate 接続
│   ├── domain/        # 34 ドメインモジュール
│   ├── data/          # NDJSON永続化層
│   └── notifications/ # Webhook通知
├── tests/             # 64 テストファイル
├── config/            # 設定JSON (experiments, ops_schedule等)
├── docs/
│   ├── runbook.md     # 運用手順書 (118KB, 最重要)
│   └── system_map.md  # CRM API仕様
└── data/              # 実行時データ (NDJSON)
```

---

## 主要CLIコマンド

```bash
# 基本パイプライン
npx ts-node src/cli/run_one_company.ts --tag "南部・3月連絡" --dry-run

# 統合運用CLI
npx ts-node src/cli/run_ops.ts daily          # 日次運用
npx ts-node src/cli/run_ops.ts weekly         # 週次運用
npx ts-node src/cli/run_ops.ts health         # ヘルスチェック
npx ts-node src/cli/run_ops.ts approvals-pick # 承認候補ピック
npx ts-node src/cli/run_ops.ts approvals-run --actor "..." --reason "..."  # 対話実行

# テスト
npm test                                      # 全テスト
npm test -- tests/specific.test.ts            # 個別テスト
```

---

## 重要な設定ファイル

| ファイル | 用途 |
|----------|------|
| `config/ops_schedule.json` | daily/weekly自動化設定 |
| `config/experiments.json` | A/B実験定義 |
| `config/priority_rules.json` | 優先度スコアリングルール |
| `.env` | 環境変数（secrets、コミット禁止） |

---

## 安全機構

1. **Kill Switch**: `KILL_SWITCH=true` または `run_ops stop-send`
2. **Allowlist**: ドメイン/メール許可リスト
3. **Rate Limit**: 日次20件制限
4. **Pre-Send Gate**: 送信前バリデーション
5. **Approval Token**: HMAC署名による改ざん防止
6. **Resume Gate**: インシデント解決前の再開ブロック

---

## 次のセッションで最初に読むべきファイル

1. **このファイル** (`docs/SESSION_HANDOFF.md`)
2. **docs/runbook.md** - 全機能の詳細（セクション7以降が運用系）
3. **config/ops_schedule.json** - 現在の自動化設定
4. **git log --oneline -20** - 直近のコミット履歴

---

## 未実装・今後の候補

P4-16まで計画は完了。次の方向性候補：

1. **本番運用準備**: CANDIDATE_MODE=real, ENABLE_AUTO_SEND=true
2. **CRM書き戻し**: sales_action API連携
3. **通知拡張**: Slack/Teams連携
4. **可視化**: メトリクスダッシュボード

---

## テスト実行方法

```bash
# 全テスト実行
npm test

# 特定テスト
npm test -- tests/interactive_runner.test.ts

# カバレッジ
npm test -- --coverage

# TypeScript型チェック
npx tsc --noEmit
```

---

## トラブルシューティング

### TypeScriptエラー (RampPolicy関連)
既知の問題。`src/domain/index.ts` のエクスポートエラー。機能には影響なし。

### テスト失敗時
モックパスを確認。`src/domain/` と `src/audit/` の違いに注意。

### 環境変数未設定
`.env.example` があれば参照。なければ `docs/runbook.md` セクション1参照。

---

## コミット規約

```bash
git commit -m "$(cat <<'EOF'
feat(P4-XX): 機能の概要

- 詳細1
- 詳細2

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## 連絡事項

- **最後のコミット**: `10b73fc` (P4-16: Interactive runner)
- **ブランチ**: main
- **リモート**: 未プッシュ（ローカルのみ）

---

*このドキュメントはセッション間の引き継ぎ用です。詳細は `docs/runbook.md` を参照してください。*
