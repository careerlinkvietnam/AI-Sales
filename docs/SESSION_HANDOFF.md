# AI-Sales セッション引き継ぎドキュメント

最終更新: 2026-01-28

---

## プロジェクト概要

**AI-Sales** は CareerLink CRM と連携した営業自動化システムです。

- **目的**: タグベースで企業を検索 → 候補者推薦 → メール下書き作成 → 安全な送信管理
- **言語**: TypeScript (Node.js)
- **データ**: NDJSON形式（DBレス）
- **制約**: PII禁止、Gmail送信(send)禁止（draftのみ）、自動承認禁止

---

## 実装状況 (2026-01-28時点)

| Phase | 内容 | 状態 |
|-------|------|------|
| P0 | CRM接続基盤 | ✅ 完了 |
| P1 | 営業パイプライン（タグ→候補者→メール下書き） | ✅ 完了 |
| P2 | CandidateClient + PriorityScorer | ✅ 完了 |
| P3-1〜P3-7 | A/Bテスト基盤・実験管理 | ✅ 完了 |
| P4-1〜P4-16 | 運用自動化・安全機構 | ✅ 完了 |
| - | Gmail OAuth連携 | ✅ 完了 |
| - | Slack通知連携 | ✅ 完了 |
| - | 企業処理ワークフロー | ✅ 完了 |
| - | CRM sales_action作成 | ✅ 完了 |

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
├── scripts/           # ユーティリティスクリプト
│   ├── list_companies.ts         # タグで企業一覧取得（次の1社を表示）
│   ├── list_all_companies.ts     # タグで企業一覧取得（全社+タグ確認）
│   ├── get_company_email.ts      # 企業メール取得
│   ├── get_company_detail.ts     # 企業詳細取得
│   ├── get_company_history.ts    # 連絡履歴取得
│   ├── create_draft.ts           # Gmail下書きテスト
│   ├── create_draft_and_notify.ts # 下書き作成+Slack通知
│   ├── create_crm_action.ts      # CRMコールメモ登録
│   ├── list_sent_emails.ts       # 送信済みメール一覧
│   └── notify_slack.ts           # Slack通知テスト
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

# ユーティリティスクリプト（企業処理フロー）
npx ts-node scripts/list_companies.ts "南部・1月連絡"       # Step1: 企業一覧取得
npx ts-node scripts/get_company_email.ts 18493              # Step2: メール確認
npx ts-node scripts/get_company_detail.ts 18493             # Step3: 企業詳細取得
npx ts-node scripts/get_company_history.ts 18493            # Step4: 連絡履歴取得
npx ts-node scripts/create_draft_and_notify.ts              # Step7-8: 下書き保存+Slack通知
npx ts-node scripts/create_crm_action.ts 18493 "担当者名" "メモ" "オフィス"  # Step10: CRM登録

# 個別テスト
npx ts-node scripts/create_draft.ts             # Gmail下書きテスト
npx ts-node scripts/notify_slack.ts             # Slack通知テスト
npx ts-node scripts/list_sent_emails.ts         # 送信済みメール確認
```

---

## 重要な設定ファイル

| ファイル | 用途 |
|----------|------|
| `config/ops_schedule.json` | daily/weekly自動化設定 |
| `config/experiments.json` | A/B実験定義 |
| `config/priority_rules.json` | 優先度スコアリングルール |
| `.env` | 環境変数（secrets、コミット禁止） |
| `scripts/notify_slack.ts` | Slack通知スクリプト |

---

## ビジネスルール

### 企業処理の重要ルール（必読）

#### ★最重要★ 作業前にマニュアル確認（必須）
- **毎回、作業を開始する前に必ず本マニュアルを読み直すこと**
- **各作業（メール作成、Slack通知、CRM登録等）の前に、該当セクションを再確認すること**
- ルールを記憶に頼らない。必ずマニュアルを読んでから作業する
- 不明点があればマニュアルを確認し、記載がなければユーザーに確認する

#### ルール1: 1社ずつ処理（ユーザーが止めるまで継続）
- **バッチ処理禁止**。必ず1社ずつ確認し、次へ進む
- 全ページ一括取得は不要。1社ずつ確認する
- **ユーザーが「止めて」と言うまで、または全企業処理完了まで継続する**
- 処理ルーティン: タグ確認 → メール確認 → 下書き作成 → Slack通知 → CRM登録 → 次の企業

#### ルール2: タグ確認はCRMで行う
- スクリプトの検索結果を鵜呑みにしない
- **必ずCRM画面で企業のタグを確認する**
- 地域（南部/北部）と月の両方が一致する企業のみ処理対象

| CRMのタグ表示 | 判断 |
|---------------|------|
| 「南部・1月連絡」あり | ✅ 処理対象 |
| 「南部・2月連絡」のみ | ❌ 対象外（2月に処理） |
| 「北部・○月連絡」 | ❌ 対象外（地域が異なる） |

#### ルール3: メールアドレスの確認順序
1. **CRMを最優先で確認**（担当者情報、会社情報、記載されているURL）
2. CRMに企業サイトURLがあれば、そのサイトでメールを探す
3. CRMにURLがなければ、Web検索で企業サイトを探す
4. 企業サイトのContactページ等でメールを探す
5. 上記すべてになければスキップ

#### ルール4: CRM書き込みは許可制
- 下書き作成・Slack通知 → 許可不要
- **CRM Action作成/更新 → ユーザーの許可必要**

#### ルール5: CRM API URLパラメータ
タグ検索の正しいURLフォーマット:
```
正: /companies/tags?tags=南部・1月連絡
誤: /companies/tags?tag=南部・1月連絡  ← tagではなくtags（複数形）
```

#### ルール6: 処理前の確認事項
1. タグが現在月か（CRMで確認）
2. メールアドレスがあるか（CRM → 企業サイトの順）
3. 既に処理済みでないか（下の「処理済み企業」セクション参照）

#### ルール7: 毎回コミット
- スクリプトやドキュメントを変更したら、**毎回コミットする**
- コミットメッセージは変更内容を簡潔に記載

#### ルール8: 新しいパターンは必ず確認
- **今までにないパターン・ケースが出てきたら、処理を止めてユーザーに確認する**
- 例: 既存クライアント（契約済み）、特殊なタグ、複数担当者、過去に問題があった企業など
- 判断に迷う場合は必ず確認してから進める

#### ルール9: 連絡頻度と担当者
- **3ヶ月に1回連絡が目安**
- 前回から3ヶ月経過していれば連絡タイミングとして正常
- **いつも佐藤さんが連絡している担当者に連絡する**
- CRMの履歴で「電話 (Ms. Sato Mai)」の相手を確認し、同じ人に連絡

#### ルール9-B: 米良さんが担当していた企業
- **米良さんは日本に転勤**になった
- 米良さんが連絡していた企業には、**佐藤さんから連絡してOK**
- メール本文に以下を含める：
  - 「これまで米良が担当しておりましたが、日本へ転勤となりました」
  - 「今後は佐藤が担当させていただきます」
  - その後、通常の本文パターン（A or B）へ続ける

#### ルール10: お問い合わせフォームがある場合
- メールアドレスがなく、企業サイトにお問い合わせフォームのみの場合
- **フォーム送信を試みる**
- **送信前に必ずユーザーに送信内容を見せて許可を得る**
- スパムフィルター等でブロックされた場合は、その企業をスキップ

#### ルール11: 質問時はCRM URLを必ず記載
- **ユーザーに確認・質問する際は、必ず該当企業のCRM URLを記載する**
- どの企業について聞いているか明確にする
- 例: `https://www.careerlink.vn:1443/executive-search/vn/companies/18493`

#### ルール12: Slack通知は必ずフォーマット通り
- Slack通知を送信する前に、**必ず本マニュアルのフォーマット（479-505行目）を確認する**
- 簡略化せず、全ての項目を記載する
- フォーマット:
  - 企業名、企業ID、連絡先種別
  - 📋 会社概要（業種・事業内容、特記事項）
  - 🎯 アクション（今回のアクション内容、使用テンプレート）
  - 📞 連絡履歴（訪問、電話、メール、最終コンタクト）
  - 宛先、宛名、件名、CRMリンク

#### ルール13: 処理済み企業にはメールアドレスを記載
- **処理済み企業テーブルには必ずメールアドレスを記載する**
- メール送信確認やCRM Action更新時に必要
- CRMから取得できない場合は「企業サイトから取得」と備考に記載

### 企業処理の完全ワークフロー（2026-01-28確定）

```
Step 0: CRMでタグ確認 ★必須★
    ↓ 必ずCRM画面で企業のタグを目視確認
Step 1: 企業選定（現在月タグの企業のみ）
    ↓
Step 2: 連絡先確認（メールあり？）
    ↓ なければスキップ → 次の企業へ
Step 3: 会社情報確認（URL、事業内容）
    ↓
Step 4: 連絡履歴確認（訪問・電話・メール）
    ↓
Step 5: メール内容決定（テンプレート選択）
    ↓
Step 6: ドラフト作成・確認
    ↓
Step 7: Gmail下書き保存
    ↓
Step 8: Slack通知（担当者へ）
    ↓
Step 9: 担当者がメール送信
    ↓
Step 10: CRM sales_action登録（コールメモ）★許可必要
```

#### 各Stepの実行方法

| Step | 内容 | 実行方法 |
|------|------|----------|
| 0 | CRMでタグ確認 | CRM画面で企業ページを開きタグを目視確認（必須） |
| 1 | 企業選定 | 現在月のタグがある企業のみ処理対象 |
| 2 | 連絡先確認 | `npx ts-node scripts/get_company_email.ts {企業ID}` |
| 3 | 会社情報確認 | `npx ts-node scripts/get_company_detail.ts {企業ID}` |
| 4 | 連絡履歴確認 | `npx ts-node scripts/get_company_history.ts {企業ID}` |
| 5 | メール内容決定 | `config/email_templates.json` 参照 |
| 6 | ドラフト作成 | `scripts/create_draft_and_notify.ts` を編集 |
| 7 | Gmail下書き保存 | `npx ts-node scripts/create_draft_and_notify.ts` |
| 8 | Slack通知 | Step 7と同時に実行される |
| 9 | メール送信 | 担当者がGmailで下書きを確認・送信 |
| 10 | CRM登録 | `CrmClient.createTelAction()` または手動 |

#### Step 10: CRM sales_action登録の詳細

**コールメモ（TelAction）とは**: 電話またはメール連絡を記録するもの。訪問は別（VisitAction）。

CRMにコールメモとして記録する。**2段階で登録・更新する。**

**Step 10-A: 下書き作成時（Gmail下書き保存後）**
- ステータス: 「下書き作成済み」
- メモ内容例: `下書き作成済み\n\n件名: 〇〇【キャリアリンク佐藤】\n宛先: xxx@xxx.com`

**Step 10-B: メール送信確認後**
- 既存のCRM Actionを**更新**（新規作成しない）
- ステータス: 「メール送付済み」に書き換え
- `updateTelAction()` を使用

**プログラムから実行:**
```typescript
import { CrmClient } from './src/connectors/crm/CrmClient';

const client = CrmClient.createFromEnv();

await client.createTelAction(
  '18454',                    // 会社ID
  '武井 順也',                 // 対応者名（CRM上の担当者名）
  '状況確認のメールを送信',     // メモ内容
  '日本本社'                   // オフィス名（省略可）
);
```

**必要な情報:**
- 会社ID
- 対応者名（メール送信先の担当者名）
- メモ内容（何をしたか）
- オフィス名（任意）

**CRM上での確認:**
- 会社ページのタイムラインに「コールメモ」として表示される
- 作成者は `ai-sales@careerlink.vn` として記録される

### 連絡先ルール
- **メールアドレスがあれば送信対象**（代表メール`info@`等も可）
- 担当者名がわかれば「〇〇様」
- 担当者名がわからなければ「採用担当者様」
- 連絡先の確認順序: `contactEmail` → `staffs[].email` → HTMLページから抽出

### 企業確認フロー
1. **会社URLを確認**: 事業内容・決算時期を把握
2. **直近のやり取りを確認**: 訪問メモ・連絡履歴を読む
3. **採用ニーズを把握**:
   - ポジション、言語要件、スキル要件
   - **NG条件を最優先で把握**（ミスマッチ防止のため最重要）
4. **Next Actionを確認**: 前回のやり取りで決まった次のアクション

### メール内容の判断
- 企業の状況・Next Actionに応じてメール内容を決める
- **候補者提案が適切なタイミングか判断する**
  - 法人設立未確定、採用時期未定の場合 → フォローアップ/状況確認
  - 具体的な採用ニーズあり → 候補者提案
- **候補者提案の自動化: 留保**（現時点では未完了）

### メール作成ルール

1. **件名の末尾に必ず追加**: `【キャリアリンク佐藤】`
   - 例: `採用活動のご状況確認【キャリアリンク佐藤】`
   - 例: `ご挨拶【キャリアリンク佐藤】`

2. **書き出しに企業名と担当者名を記載**:
   - 形式: `{企業名}\n{担当者名}様`
   - 例:
     ```
     株式会社ABC
     山田様
     ```
   - 担当者名がわからない場合:
     ```
     株式会社ABC
     採用ご担当者様
     ```

### メールフッター（署名）★変更禁止★

全てのメールに以下のフッターを使用する。**絶対に変更しない。**

```
--
『人をつなぎ、キャリアを創る』
キャリアリンク (CareerLink Co., Ltd.)
佐藤　舞 (Ms. Mai Sato)
Mobile : (+84)091-140-1961
Tel(日本人直通) : 028-3812-7983
HR-Website : https://www.CareerLink.vn
License : 31116/SLDTBXH-GPGH
-----------------------------------
ホーチミンヘッドオフィス(HCMC Head Office) :
Room 302, 270–272 Cong Hoa Street, Tan Binh Ward, Ho Chi Minh City
------------------------------------
ハノイオフィス(HN Office) :
Room 307, DMC Tower, 535 Kim Ma St, Giang Vo Ward, Ha Noi City
Tel: (024) 3519 0410
ダナンオフィス(DN Office)：
8th Floor, ACB Da Nang Tower, 218 Bach Dang St, Hai Chau Ward, Da Nang City
■日本(Japan Office)
キャリアリンクアジア株式会社
千葉県千葉市中央区栄町36－10　甲南アセット千葉中央ビル5F-D
厚生労働大臣許可番号：12-ユ-300460
登録支援許可番号：20登-003823
■タイ(Thai office)
CareerLink Recruitment Thailand Co.,Ltd.
Room 58S, 47 Sukhumvit 69 Rd., Phra Khanong Nuea, Watthana, Bangkok, Thailand
```

### 基本メールテンプレート（5パターン）
設定ファイル: `config/email_templates.json`

| パターン | 用途 | 特徴 |
|----------|------|------|
| 1: status_check_with_pricing | 状況確認（料金案内付き） | 料金情報あり |
| 2: post_call_service_intro | 電話後フォロー | 2サービス詳細、資料添付 |
| 3: soft_reminder | リマインド（ソフト） | プレッシャーなし、思い出してもらう |
| 4: simple_status_check | シンプル状況確認 | 最短、料金なし |
| 5: status_check_with_service_names | 状況確認（サービス名） | サービス名のみ言及 |

**選択ガイド:**
- 電話後 → パターン2
- 今すぐニーズなさそう → パターン3
- 定期フォロー（料金案内） → パターン1
- 定期フォロー（シンプル） → パターン4 or 5

### 本文パターン（定期フォロー用）

**パターンA: 具体的な価値を伝える**
※職種は企業の業種に合わせて変更する（下記「職種カスタマイズルール」参照）
```
弊社では日系企業様向けに、{職種}、その他御社の業務内容に
合った候補者のご紹介を数多く行っております。

「こんな人材がいたら相談したい」
「まずは市場の状況だけ知りたい」

といったご相談も歓迎しております。
お気軽にご連絡いただければ幸いです。
```

**パターンB: シンプルに親しみやすく**
※職種は企業の業種に合わせて変更する（下記「職種カスタマイズルール」参照）
```
弊社では{職種}、その他御社の業務内容に合った
候補者のご紹介が可能です。

もし採用についてお困りのことがあれば、
お気軽にご相談ください。

「まだ具体的ではないけど、ちょっと話を聞きたい」
というご連絡も大歓迎です。
```

**パターンC: 求人受領中クライアント向け**
```
現在いただいている求人状況について、
変更などはございませんでしょうか？

追加のご要望などございましたら、
お気軽にお申し付けください。
```
※「南部・求人受領中」等のタグがある企業に使用

**ルール: パターンは交互に使用する**
- 同じパターンを連続で使わない
- 企業ごとにA→B→A→B...と交互に使用
- バリエーションを持たせることで、テンプレート感を減らす

**訪問済み企業への挨拶ルール**
「佐藤・訪問済」タグがある企業への書き出しは、時間経過を考慮する：

| 状況 | 書き出し例 |
|------|-----------|
| 訪問から1ヶ月以内 | 「お世話になっております。」または「先日はお時間をいただきありがとうございました。」 |
| 訪問から1〜3ヶ月 | 「お世話になっております。」 |
| 訪問から3〜6ヶ月 | 「ご無沙汰しております。」 |
| 訪問から6ヶ月以上 | 「大変ご無沙汰しております。」 |
| 訪問日不明（タグのみ） | 「ご無沙汰しております。以前お伺いした際は大変お世話になりました。」 |

※「お世話になっております」は面識がない相手、または最近連絡した相手に使用OK

**件名も状況に応じて変更する：**
| 状況 | 件名例 |
|------|--------|
| 初回コンタクト・面識なし | 「ご挨拶【キャリアリンク佐藤】」 |
| 訪問済み・面識あり | 「採用活動のご状況確認【キャリアリンク佐藤】」 |
| 求人受領中 | 「採用活動のご状況確認【キャリアリンク佐藤】」 |

**職種カスタマイズルール**
パターンAの職種は企業の業種に合わせて変更する：

| 業種 | 職種例 |
|------|--------|
| IT・オフショア | ITエンジニア、SE、プログラマー |
| 製造・工場 | 生産管理、品質管理、技術者 |
| 商社・メーカー | 営業、営業事務、貿易事務 |
| 建設 | 施工管理、現場監督、CADオペレーター |
| 物流 | 物流管理、倉庫管理、通関士 |
| サービス・コンサル | コンサルタント、アシスタント |
| 法務・会計 | 法務担当、経理、会計スタッフ |
| 飲食・サービス | 店長候補、サービススタッフ |
| 一般（不明時） | 日本語人材・バイリンガル人材 |

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
2. ~~**CRM書き戻し**: sales_action API連携~~ → ✅ 完了 (`CrmClient.createTelAction()`)
3. ~~**通知拡張**: Slack/Teams連携~~ → ✅ Slack完了
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

### CRM認証エラー / セッション切れ

**症状**: `Session expired` または `Not a valid session`

**原因**: Cookie管理またはログインフローの問題、またはセッションタイムアウト

**重要**: セッションが切れた場合は、自動的に再ログインを行うこと。
- CLIコマンド（`run_one_company.ts`等）は実行時に自動で再接続される
- スクリプトで直接CRMにアクセスする場合は `scripts/get_company_email.ts` を参考に再ログイン処理を実装

**対処**:
1. `.env` に正しい環境変数を設定：
   - `CRM_BASE_URL=https://www.careerlink.vn:1443/executive-search/vn`
   - `CRM_AUTH_HOST=https://www.careerlink.vn:1443`
   - `CRM_AUTH_PATH=/siankaan0421/login_check`
   - `CRM_LOGIN_EMAIL` と `CRM_LOGIN_PASSWORD`
2. 詳細は `docs/system_map.md` セクション7.5〜7.6参照

**認証フロー（2026-01-27確認済み）**:
1. GET `/siankaan0421/login` → CSRFトークンとCookie取得
2. POST `/siankaan0421/login_check` → ログイン
   - Content-Type: `application/x-www-form-urlencoded`
   - Body: `_username=<email>&_password=<password>&authenticity_token=<CSRF>`
3. 新しいCookieで古いCookieを上書き（重複回避）
4. 以降のAPIリクエストにCookieを使用

### API応答形式の注意

- `/companies/tags`: **HTMLのみ**（JSONは406エラー）→ CrmClientがHTMLパースで対応
- `/companies/{id}`: **JSON**で企業詳細取得可能（ただし担当者メールは含まれない）
- `/timeline/companies/{id}`: 現在500エラーが発生する場合あり → 空履歴で続行

### 担当者メールアドレスの取得

**重要発見** (2026-01-27): JSON APIは担当者のメールアドレスを返さない。HTMLページには表示されている。

**対応**: `getCompanyDetail`でJSONに加えてHTMLページも取得し、メールアドレスを正規表現で抽出。

```typescript
// HTMLからメールを抽出（careerlink.vnドメインは除外）
const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
```

### TypeScriptエラー (RampPolicy関連)
既知の問題。`src/domain/index.ts` のエクスポートエラー。機能には影響なし。

### テスト失敗時
モックパスを確認。`src/domain/` と `src/audit/` の違いに注意。

### 環境変数未設定
`.env.example` があれば参照。なければ `docs/runbook.md` セクション1参照。

### Gmail OAuth設定

Gmail下書き作成には OAuth2 認証が必要。

**現在のGmailアカウント**: `sato@careerlink.vn`

**必要な環境変数** (`.env`):
```
GMAIL_CLIENT_ID=xxxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxxxx
GMAIL_REFRESH_TOKEN=1//xxxxx
```

**Gmailアカウント変更方法**:
1. OAuth Playground (https://developers.google.com/oauthplayground) にアクセス
2. 歯車 → 「Use your own OAuth credentials」にチェック
3. 既存のClient ID/Secretを入力
4. 「Input your own scopes」に `https://mail.google.com/` を入力
5. 「Authorize APIs」→ **新しいアカウント**でログイン
6. 新しいRefresh tokenを`.env`に設定

**設定手順**:

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→「ライブラリ」→ Gmail API を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定
4. 「APIとサービス」→「認証情報」→ OAuth 2.0 クライアントID作成
   - 種類: ウェブアプリケーション
   - 承認済みリダイレクトURI: `https://developers.google.com/oauthplayground`
5. [OAuth Playground](https://developers.google.com/oauthplayground) でリフレッシュトークン取得:
   - 右上歯車 → 「Use your own OAuth credentials」にチェック
   - Client ID と Client Secret を入力
   - **重要**: 「Input your own scopes」に `https://mail.google.com/` を入力
   - 「Authorize APIs」→ ログイン → 「Exchange authorization code for tokens」
   - Refresh token をコピー

**よくあるエラー**:
- `unauthorized_client`: OAuth Playgroundで「Use your own OAuth credentials」がチェックされていない
- `403 Missing access token`: スコープが間違っている（`gmail.addons`ではなく`mail.google.com`を使用）

### Slack通知設定

下書き作成時にSlackへ通知を送信。

**必要な環境変数** (`.env`):
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXXXX/XXXXX/XXXXX
```

**Webhook URL取得手順**:
1. https://api.slack.com/apps でアプリ作成
2. 「App Home」でBot Display Nameを設定（必須）
3. 「Incoming Webhooks」を有効化
4. 「Add New Webhook to Workspace」でチャンネル選択
5. 生成されたWebhook URLをコピー

**通知スクリプト使用方法**:
```bash
npx ts-node scripts/notify_slack.ts              # テスト送信
npx ts-node scripts/create_draft_and_notify.ts   # 下書き作成+通知
```

### CRM sales_action作成（コールメモ）

メール送信後のCRM記録用。`CrmClient.createTelAction()`でコールメモを作成。

**使用方法**:
```typescript
import { CrmClient } from './src/connectors/crm/CrmClient';

const client = CrmClient.createFromEnv();

await client.createTelAction(
  '18454',           // 会社ID
  '武井 順也',        // 担当者名
  'メールを送信',     // メモ
  '日本本社'          // オフィス名（省略可）
);
```

**APIフォーマット**:
- Endpoint: `POST /executive-search/vn/companies/{id}/sales_actions`
- Content-Type: `application/x-www-form-urlencoded`
- 必要ヘッダー: `x-csrf-token`, `x-requested-with: XMLHttpRequest`
- フィールド: `sales_tel_action[id]=new`, `sales_tel_action[company_id]`, `sales_tel_action[performed_at]` (Unix timestamp), `sales_tel_action[staff_name]`, `sales_tel_action[place]`, `sales_tel_action[log]`

**注意**: `_hr_frontend_session` Cookieが必要。CrmClientは自動的にexecutive-searchページにアクセスして取得。

**Slack通知フォーマット**:
```
📧 下書き作成完了

企業: [企業名]
企業ID: [ID]
連絡先: ✅ 担当者個人メール / ⚠️ 代表メール（個人メールなし）

📋 会社概要:
• [業種・事業内容]
• [特記事項]

🎯 アクション:
• [今回のアクション内容]
• [使用テンプレート]

📞 連絡履歴:
• 訪問: [日付 担当者] または なし
• 電話: [日付 担当者] または なし
• メール: [日付 内容] または なし
• 最終コンタクト: [日付（種別）] または なし（新規登録）

宛先: [メールアドレス]
宛名: [〇〇様]
件名: [メール件名]
CRM: [リンク]
```

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
- **Gmailアカウント**: `sato@careerlink.vn`
- **Slackチャンネル**: AI-Sales通知（Webhook設定済み）

### 処理済み企業（2026-01-28）
| 企業ID | 企業名 | メールアドレス | 状態 | 備考 |
|--------|--------|----------------|------|------|
| 18454 | アルプス システム インテグレーション株式会社 | junya.takei@alsi.co.jp | ✅ 下書き作成済み | |
| 18493 | Supremetech Co.,Ltd | info@supremetech.vn | ✅ メール送信済み | CRM Action 234597 |
| 18484 | Access Professional Vietnam | - | ❌ 誤処理（3月タグ） | CRM Action 234601 要削除 |
| 18265 | Vina Takeuchi Co.,LTD | info@v-takeuchi.vn | ✅ 下書き作成済み | CRM Action 234633 |
| 18072 | Vina Nide Co.,LTD | info@vinanide.com | ✅ 下書き作成済み | CRM Action 234635 |
| 18061 | LJTrading Co.,LTD | info@lj-worldwide.com | ✅ 下書き作成済み | CRM Action 234637（企業サイトでメール発見） |
| 17991 | Sankei Manufacturing Vietnam | n-kubota@ngo-sankei.co.jp | ✅ 下書き作成済み | CRM Action 234638（窪田様宛て） |
| 17854 | Vietnam Shell Stone Co.,LTD | shellstonevietnam@gmail.com | ✅ 下書き作成済み | CRM Action 234639（貝原様宛て） |
| 17758 | Unifast Co.,Ltd | usukura@unifast.co.jp | ✅ 下書き作成済み | CRM Action 234640（臼倉様宛て、米良引き継ぎ） |
| 17681 | Daiichi Corporation Vietnam | w-murayama@daiichi-j.co.jp | ✅ 下書き作成済み | CRM Action 234641（Murayama様宛て） |
| 17555 | Alpia Vietnam Co.,Ltd | satoshi-sato@jeicreate.net | ✅ 下書き作成済み | CRM Action 234642（企業サイトでメール発見） |
| 17529 | One Asia Lawyers Vietnam | fubito.yamamoto@oneasia.legal | ✅ 下書き作成済み | CRM Action 234643（山本様宛て、求人受領中・パターンC） |
| 17478 | Matsusaka EDP Center Infotech Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234644（柴原様宛て、パターンA） |
| 17420 | Arent Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234645（後藤様宛て、パターンB） |
| 17290 | Aria Vietnam Inc | 要確認 | ✅ 下書き作成済み | CRM Action 234646（別府様宛て、パターンA） |
| 17281 | HARIMA FC | 要確認 | ✅ 下書き作成済み | CRM Action 234647（内藤様宛て、パターンB・営業/事務） |
| 17264 | NK LINKS VIET NAM | sato@tosmac-vietnam.com | ✅ 下書き作成済み | CRM Action 234648（佐藤様宛て、パターンA・サービス） |
| 17255 | AVT INTERNATIONAL JSC | hello@avt.com.vn | ✅ 下書き作成済み | CRM Action 234649（採用担当者様宛て、パターンB・建設） |
| 17158 | Capco Vietnam | imazu01@central-auto.co.jp | ✅ 下書き作成済み | CRM Action 234651（今津様宛て、パターンA・訪問済み） |
| 17128 | TAKARA BELMONT COSMETICS | ui_akamine@takarabelmont.vn | ✅ 下書き作成済み | CRM Action 234652（赤嶺様宛て、パターンB・製造） |
| 17029 | VINEPRO | info@vinect-production.com | ✅ 下書き作成済み | CRM Action 234653（採用担当者様宛て、パターンA・広告） |
| 16983 | Mercuria Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234654（百田様宛て、パターンB・コンサル） |
| 16970 | TENNO ENGINEERING | 要確認 | ✅ 下書き作成済み | CRM Action 234655（採用担当者様宛て、パターンA・製造） |
| 16908 | Maruyama Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234656（熱田様宛て、パターンB・訪問済み） |
| 16836 | Monorevo Vietnam | 要確認 | ✅ 下書き作成済み | CRM登録エラー（要手動登録）細井様宛て、パターンA・IT |

### 未処理企業（次回継続）
| 企業ID | 企業名 | 備考 |
|--------|--------|------|
| 16811 | Thankslab Vietnam | 求人受領中・人材紹介契約済、高橋様宛て、パターンC使用予定 |

### スキップ企業（メールなし）
| 企業ID | 企業名 | 理由 |
|--------|--------|------|
| 18473 | Ogawa Econos Vietnam | メールなし |
| 18466 | Link Station Vietnam | メールなし（連絡先不明タグ付与） |
| 18464 | Itochu Logistics Vietnam | メールなし |
| 18446 | Otasuke | メールなし |
| 18261 | Gildaon Vietnam | メールなし |
| 18243 | Yamamori Vietnam | メールなし（連絡先不明タグ付与） |
| 18062 | Osaki Precision Co.,LTD | メールなし（電話・フォームのみ） |
| 17984 | Japan Wood House Vietnam | メールなし（フォームのみ、自動送信不可） |
| 17974 | Bonsai Sane Co.,LTD | メールなし、企業サイトなし |
| 17845 | Toei Techno International Vietnam | メールなし |
| 17823 | Hirochiku Asia Vietnam | メールなし（電話・フォームのみ） |
| 17688 | Yoshikawa Logistics Vietnam | メールなし |
| 17631 | Fujita-Denko Vietnam | メールなし |
| 17462 | Vietnam Globits Technology | 連絡先不明タグ、適切なメールなし |
| 17343 | HIROSE CONSULTING VIETNAM | メールなし、企業サイトなし |
| 17316 | AVIENA STUDIO | 連絡先不明タグ、メールなし |
| 17314 | CHUO KAKOHKI VIETNAM | 日本人不在タグ、メールなし |
| 17223 | TOKAI PRECUT VN | 連絡先不明、メールなし |
| 17221 | VIETNAM KISANUKI FURNITURE | 連絡先不明、メールなし |
| 17190 | MIZUNO MOLD VIETNAM | メールなし、企業サイトなし |
| 17106 | Ikeda Kousho Vietnam | 連絡先不明、メールドメイン不一致 |
| 16923 | Vietnam Kuriya | 連絡先不明、メールなし |

### 処理対象外（タグ不一致）
以下の企業は「南部・1月連絡」の検索結果に出るが、実際のタグが異なるため処理対象外：

| 企業ID | 企業名 | 実際のタグ | 除外理由 |
|--------|--------|-----------|----------|
| 18491 | License Vietnam | 南部・3月 | 月が異なる |
| 18484 | Access Professional Vietnam | 南部・3月 | 月が異なる |
| 18482 | Asia Travel & Investment | 北部・1月 | 地域が異なる |
| 18481 | Vinfu Software Vietnam | 南部・2月 | 月が異なる |

---

*このドキュメントはセッション間の引き継ぎ用です。詳細は `docs/runbook.md` を参照してください。*
