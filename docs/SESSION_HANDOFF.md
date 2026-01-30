# AI-Sales セッション引き継ぎドキュメント

最終更新: 2026-01-30

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
│   ├── pre_check.ts              # ★処理前必須チェック（必ず最初に実行）
│   ├── list_companies.ts         # タグで企業一覧取得（次の1社を表示）
│   ├── list_all_companies.ts     # タグで企業一覧取得（全社+タグ確認）
│   ├── get_company_email.ts      # 企業メール取得
│   ├── get_company_detail.ts     # 企業詳細取得
│   ├── get_company_history.ts    # 連絡履歴取得
│   ├── create_email_draft.ts     # 下書き作成+Slack通知（JSONファイル入力）
│   ├── create_crm_action.ts      # CRMコールメモ登録
│   ├── list_sent_emails.ts       # 送信済みメール一覧
│   ├── list_slack_notifications.ts # Slack通知履歴確認
│   ├── update_month_tag.ts       # 月タグ更新（+3ヶ月）
│   ├── notify_skip.ts            # スキップ通知（テンプレート）
│   ├── search_sent_to.ts         # Gmail送信履歴検索
│   ├── list_drafts.ts            # Gmail下書き一覧
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
npx tsx scripts/create_email_draft.ts ./drafts/会社ID.json  # Step7-8: 下書き保存+Slack通知
npx ts-node scripts/create_crm_action.ts 18493 "担当者名" "メモ" "オフィス"  # Step10-A: CRM登録
npx tsx scripts/update_month_tag.ts 18493                                    # Step10-C: タグ更新

# 個別テスト
npx tsx scripts/create_email_draft.ts           # 下書き作成（JSON入力必須）
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

#### ★過去の失敗から学ぶ★ よくある間違いと防止策

**間違い1: CRMを確認せずに処理する**
- ❌ スクリプトの検索結果だけで判断する
- ❌ SESSION_HANDOFF.mdの情報だけで判断する
- ✅ **必ずCRM画面を開いて、現在のタグ・状況を確認してから処理**

**間違い2: 「下書き作成済み」と「送信済み」を混同する**
- ❌ 下書き作成後にタグを更新する
- ✅ **タグ更新はメール送信確認後のみ**
- ✅ SESSION_HANDOFF.mdの状態欄を確認（「下書き作成済み」≠「送信済み」）

**間違い3: 自分の記録を確認せずに質問する**
- ❌ 「この企業は処理済みですか？」とユーザーに聞く
- ✅ **まずCRMコールメモとSESSION_HANDOFF.mdを確認**
- ✅ 自分で作成した記録があるか確認してから質問

**間違い4: 対象月と異なるタグの企業を処理する**
- ❌ 「1月連絡」で検索して出てきた企業を確認せず処理
- ✅ **CRMで実際のタグを確認し、対象月と一致する場合のみ処理**
- ✅ 異なる場合は何もせず次へ

**間違い5: 思い込みで行動する**
- ❌ 「〜のはず」「〜だろう」で処理を進める
- ✅ **必ず確認してから行動**
- ✅ 確認項目: CRMタグ、処理済みリスト、送信状況

**間違い6: 自動で確認できることをユーザーに聞く**
- ❌ 「メールは送信されましたか？」とユーザーに聞く
- ✅ **Gmailで送信履歴を自動確認する**
- ✅ pre_check.tsが自動でGmail送信確認を行う

**間違い7: 古いメールを今回送信したメールと混同する**
- ❌ Gmailで見つかったメール = 今回の下書きが送信された
- ✅ **送信日時を確認し、下書き作成日より後かどうか確認**
- ✅ 2025年11月のメールは、2026年1月に作成した下書きの送信ではない
- ✅ 下書き作成日時とGmailの送信日時を比較する

#### ルール1: 1社ずつ処理（ユーザーが止めるまで継続）
- **バッチ処理禁止**。必ず1社ずつ確認し、次へ進む
- 全ページ一括取得は不要。1社ずつ確認する
- **ユーザーが「止めて」と言うまで、または全企業処理完了まで継続する**
- 処理ルーティン: タグ確認 → メール確認 → 下書き作成 → Slack通知 → CRM登録 → 次の企業

#### ルール2: 常にCRMで直接確認する（状況は変化する）
- **スクリプトの検索結果やキャッシュを鵜呑みにしない**
- **処理直前に必ずCRM画面で企業情報を確認する**
- 状況は常に変化する：タグ、担当者、求人状況など
- 以前のセッションのデータは古くなっている可能性がある
- 地域（南部/北部）と月の両方が一致する企業のみ処理対象

**★重要★ タグ確認の徹底:**
- 検索結果に表示されても、**CRMで実際のタグを確認してから処理する**
- 例: 「南部・1月連絡」で検索しても、CRMで「南部・4月連絡」になっていたら処理対象外
- 対象月と異なるタグの場合、**何もせず次の企業へ進む**（タグ更新もしない）
- SESSION_HANDOFF.mdの情報も古くなっている可能性があるため、常にCRMが正

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

#### ルール11-B: 質問する前に自分の記録を確認する
- **ユーザーに質問する前に、以下を必ず確認する:**
  1. **CRMコールメモ** - 自分（AI）が作成したメモがないか確認
  2. **SESSION_HANDOFF.md** - 処理済み企業リストに記載がないか確認
- 自分で作成した記録があるのに質問するのは無駄
- 記録を確認した上で、不明点があれば質問する

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

#### ルール14: 連絡履歴から言語・担当者を確認
メール作成前に、CRMの連絡履歴（コールメモ）を確認し、以下を把握する：

1. **過去の連絡相手**
   - 誰とやり取りしていたか（名前・メールアドレス）
   - 直近の担当者を優先

2. **使用言語**
   - 過去のメモに「英語」「English」等の記載があれば英語で送信
   - 「日本人不在」「英語話者」等の記載にも注意

3. **連絡先の優先順位**
   - 過去にやり取りした担当者のメール > CRM登録のメール > 代表メール

**例（AVT INTERNATIONAL JSC）:**
- 履歴: 「Tan Vanさんへ英語でメール送信」
- 対応: hello@avt.com.vn ではなく tan.van@avt.com.vn に英語で送信

#### ルール14-B: お客様に刺さるメールを作成する（テンプレートは参考例）

**★重要★ テンプレートは参考例であり、そのまま使うものではない**

メール作成前に、以下の情報を**すべて確認**し、お客様との関係性を踏まえた**パーソナライズされたメール**を作成する。

**確認すべき情報:**
1. **Gmail送信履歴** - 過去のメール内容を読む
   ```bash
   npx tsx scripts/search_sent_to.ts "@ドメイン名"
   ```
   - 何を提案したか（ポジション、候補者名など）
   - 相手の反応・返信内容
   - どのような話の流れだったか

2. **CRMコールメモ** - 電話でのやり取り
   - 電話で話した内容
   - お客様の状況・課題・ニーズ
   - 担当者の人柄・関心事

3. **CRM訪問メモ** - 訪問時の記録
   - 訪問時に話した内容
   - オフィスの雰囲気、会社の状況
   - 今後の採用計画

**メール作成の考え方:**
- テンプレートは「こういう要素を含める」という参考
- 実際のメールは、上記の情報を踏まえて**一から考える**
- 「このお客様に何を伝えれば響くか」を考える
- 前回のやり取りの続きとして自然な流れにする

**悪い例（テンプレートをそのまま使用）:**
- 過去に金型エンジニアを提案したのに「営業職のご紹介が可能です」と書く
- 訪問して詳しく話したのに「初めてご連絡いたします」と書く
- 前回「今は採用予定なし」と言われたのに「採用状況はいかがでしょうか」と書く

**良い例（関係性を踏まえた内容）:**
- 「前回10月に金型エンジニアをご提案しましたが、その後いかがでしょうか。引き続き日本語話者の技術者をお探しでしたら、ぜひご相談ください」
- 「先日のご訪問では、来年度の増員計画についてお聞かせいただきありがとうございました。時期が近づいてまいりましたので、改めてご連絡いたしました」
- 「前回は採用のタイミングではないとのことでしたが、その後状況に変化はございましたでしょうか。必要なタイミングでお声がけいただければ幸いです」

**メール作成フロー:**
1. Gmail送信履歴を確認 → 過去のメール内容を読む
2. CRMコールメモ・訪問メモを確認 → お客様の状況を把握
3. 「このお客様に何を伝えるべきか」を考える
4. テンプレートを参考にしつつ、パーソナライズしたメールを作成
5. 下書き作成 → プレビューで内容確認

**メール作成の追加注意点:**

1. **過去の経緯を理解した上で、触れるべき内容を判断する**
   - 古い話題（時間が経った提案など）は触れなくてよい場合がある
   - 何を書くかだけでなく、**何を書かないか**も重要

2. **相手との関係性に合ったトーンにする**
   - 初回コンタクト → 自己紹介・サービス紹介
   - 既存の関係 → 「その後いかがでしょうか」など継続的な関係を前提とした書き方

3. **テンプレートをそのまま使わない**
   - 企業の事業内容（金型・組み立てなど）を具体的に盛り込む
   - その会社に向けて書いている感を出す

#### ルール14-C: メールフォーマットの厳守事項

**以下は変更禁止。必ずこの形式で作成すること。**

**1. 宛名（必須フォーマット）:**
```
[会社名（英語）]
[担当者名]様
```
例:
```
Tombow Manufacturing Asia Co., Ltd.
小野寺様
```
- 会社名は必須（省略禁止）
- 会社名の後に改行して担当者名

**2. 署名（変更禁止）:**
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
```
- この署名は一字一句変更禁止
- 勝手に省略したり、別の形式にしない

**3. メール全体の構成:**
```
[会社名]
[担当者名]様

お世話になっております。
キャリアリンクの佐藤でございます。

[本文 - パーソナライズした内容]

[結び]

[署名]
```

#### ルール15: 求人受領中の企業はスキップ
- 「求人受領中」タグがある企業は、月タグがあっても**メール作成不要**
- すでにアクティブな取引があるため、定期フォローメールは不要
- **対応:**
  1. Gmail送信履歴で最終連絡日を確認
  2. Slackにスキップ通知を送信（最終連絡情報を含む）
  3. 月タグを3ヶ月先に更新（例: 1月→4月）

**最終連絡日の確認方法:**
```bash
npx tsx scripts/search_sent_to.ts "to:@ドメイン"
```

**スキップ通知スクリプト:**
```bash
# 求人受領中（タグ更新あり）
npx tsx scripts/notify_skip.ts <companyId> "<会社名>" "求人受領中のためメール不要" "<日付>" "<担当者名>" "<email>" "<旧月→新月>"

# 例
npx tsx scripts/notify_skip.ts 17529 "One Asia Lawyers Vietnam" "求人受領中のためメール不要" "2025/07/11" "山本様" "fubito.yamamoto@oneasia.legal" "1月→4月"
```

**Slack通知フォーマット:**
```
🔴 スキップ: [会社名] ([会社ID])
理由: 求人受領中のためメール不要
最終連絡: [日付] [担当者名] ([メールアドレス])
タグ更新: 南部・X月連絡 → 南部・Y月連絡
CRM: [URL]
```

#### ルール16: 過去求人受領企業の最終連絡日を確認
- 「過去求人受領」タグがある企業は、最終連絡日を確認する
- **3ヶ月以内に連絡済み → スキップ**
- **3ヶ月以上経過 → メール送信対象**

#### ルール16-B: 求人受領タグがなくても3ヶ月以内連絡済みはスキップ
- Gmail送信履歴で最終連絡日を確認
- **3ヶ月以内に連絡済み → スキップ**（タグの有無に関わらず）
- スキップ時の処理:
  1. Slackにスキップ通知を送信（最終連絡日を含む）
  2. タグを3ヶ月先に更新
  3. SESSION_HANDOFF.mdに記録

**確認方法:**
```bash
npx tsx scripts/search_sent_to.ts "to:@ドメイン"
```

**スキップ通知スクリプト:**
```bash
# 過去求人受領（Slack通知にタグ更新情報を含める）
npx tsx scripts/notify_skip.ts <companyId> "<会社名>" "過去求人受領・3ヶ月以内に連絡済み" "<日付>" "<担当者名>" "<email>" "<旧月→新月>"
npx tsx scripts/update_month_tag.ts <companyId>

# 例
npx tsx scripts/notify_skip.ts 17991 "Sankei Manufacturing Vietnam" "過去求人受領・3ヶ月以内に連絡済み" "2025/11/05" "窪田様" "n-kubota@ngo-sankei.co.jp" "1月→4月"
npx tsx scripts/update_month_tag.ts 17991
```

**重要: スキップ時も必ずタグ更新すること**
- スキップ理由に関わらず、処理したらタグを3ヶ月先に更新
- **Slack通知には必ずタグ更新情報（旧月→新月）を含める**
- これにより次回処理時に再度リストに表示されることを防ぐ

#### ルール17: メール送信確認後の必須手順（順序厳守）
メール送信を確認したら、以下を**この順番で**実行する：

```
□ 1. CRMコールメモを「メール送付済み」に更新
   - 宛先、宛名、件名、送信日を記載
□ 2. タグを3ヶ月先に更新
□ 3. SESSION_HANDOFF.mdを更新
```

**※タグ更新の前に必ずCRMコールメモを更新すること**

### 新しい月タグの処理開始手順

**新しい月（例: 南部・1月連絡）を処理開始する際は、以下の手順で全企業をリスト化してから1件ずつ処理する:**

```bash
# Step 1: 全企業IDをファイルに出力
npx tsx scripts/list_all_companies.ts "南部・1月連絡" 2>&1 | grep "^\[" | sed 's/\[//' | sed 's/\].*//' > /tmp/january_companies.txt

# Step 2: 件数確認
wc -l /tmp/january_companies.txt

# Step 3: 先頭から1件ずつpre_check.tsで確認して処理
head -1 /tmp/january_companies.txt  # 最初の企業ID取得
npx tsx scripts/pre_check.ts <企業ID> 1
```

**処理ルール:**
- 全件をリスト化してから、上から順番に処理
- 1件処理したら次へ進む（飛ばさない）
- 処理済み・スキップ済みも含めて全件確認する
- **★重要★ 1件処理するごとにSESSION_HANDOFF.mdを更新**
  - 再処理を防ぐため、こまめに管理簿を整理する
  - スキップした企業も理由を記録
  - タグ更新した場合は更新後のタグを記録

---

### 企業処理の完全ワークフロー（2026-01-30更新）

**★最重要★ 処理開始前に必ずpre_check.tsを実行**

```bash
npx tsx scripts/pre_check.ts <companyId> <targetMonth>
# 例: npx tsx scripts/pre_check.ts 16970 1
```

このスクリプトがチェックする項目:
1. CRMタグが対象月と一致するか
2. SESSION_HANDOFF.mdに処理済み記載があるか
3. 下書き作成済みの場合、Gmailで送信済みか自動確認
4. 送信済みならタグ更新コマンドを表示

**チェックに通らない場合は処理を開始してはいけない**

```
Step 0: pre_check.ts実行 ★必須★
    ↓ チェックに通らなければ処理しない
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
| 0 | 処理前チェック | `npx tsx scripts/pre_check.ts {企業ID} {対象月}` ★必須★ |
| 1 | 企業選定 | チェックに通った企業のみ処理対象 |
| 2 | 連絡先確認 | `npx ts-node scripts/get_company_email.ts {企業ID}` |
| 3 | 会社情報確認 | `npx ts-node scripts/get_company_detail.ts {企業ID}` |
| 4 | 連絡履歴確認 | `npx ts-node scripts/get_company_history.ts {企業ID}` |
| 5 | メール内容決定 | 過去メール確認 → テンプレート選択 → カスタム段落作成 |
| 6 | JSONファイル作成 | `drafts/企業ID_企業名.json` を作成 |
| 7 | Gmail下書き保存 | `npx tsx scripts/create_email_draft.ts ./drafts/xxx.json` |
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
- **必ず以下の情報をメモに含める**:
  - 宛先（メールアドレス）
  - 宛名（〇〇様）
  - 件名
  - 送信日時

**メモフォーマット例**:
```
メール送付済み

宛先: example@company.com
宛名: 山田様
件名: ご挨拶【キャリアリンク佐藤】
送信日: 2026/01/30 09:36
```

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

**Step 10-C: タグ更新（メール送信確認後）**
- **★重要★ タグ更新はメール送信確認後のみ**
- 「下書き作成済み」の段階ではタグ更新しない
- ユーザーがメールを送信し、送信済みを確認してからタグを更新
- 例: 「南部・1月連絡」 → 「南部・4月連絡」
- 他のタグは変更しない（日系企業、IT・ゲーム等はそのまま）

**スクリプトで実行:**
```bash
npx tsx scripts/update_month_tag.ts <companyId>
```

**プログラムから実行:**
```typescript
import { CrmClient } from './src/connectors/crm/CrmClient';

const client = CrmClient.createFromEnv();
const result = await client.updateMonthTag('16811');
// result: { oldTag: '南部・1月連絡', newTag: '南部・4月連絡', allTags: [...] }
```

**月タグ変換ルール:**
| 現在のタグ | 新しいタグ |
|------------|------------|
| 1月連絡 | 4月連絡 |
| 2月連絡 | 5月連絡 |
| 3月連絡 | 6月連絡 |
| ... | ... |
| 10月連絡 | 1月連絡 |
| 11月連絡 | 2月連絡 |
| 12月連絡 | 3月連絡 |

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

1. **件名は本文を書いてから決める**:
   - まず本文を作成する
   - 本文の内容に合った件名を作成する
   - 件名で何について書いているかわかるようにする

2. **件名のフォーマット**: `[内容]【キャリアリンク佐藤】`
   - 末尾に必ず `【キャリアリンク佐藤】` を追加
   - 【】は全角カッコを使用（半角[]は不可）
   - スペースなしで直接つなげる

   **例:**
   - 金型エンジニアのご提案について【キャリアリンク佐藤】
   - 採用活動のご状況確認【キャリアリンク佐藤】
   - ご挨拶【キャリアリンク佐藤】
   - 先日の訪問のお礼【キャリアリンク佐藤】

   **悪い例:**
   - ご挨拶 【キャリアリンク佐藤】 ← スペースが入っている
   - ご挨拶[キャリアリンク佐藤] ← 半角カッコ
   - 【キャリアリンク佐藤】ご挨拶 ← 順番が逆

3. **書き出しに企業名と担当者名を記載**（ルール14-C参照）:
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

**★これらは参考例です。そのままコピーして使わないこと★**
- ルール14-Bに従い、過去のメール・コールメモ・訪問メモを確認
- お客様との関係性を踏まえ、パーソナライズしたメールを作成
- 以下のパターンは「こういう要素を含める」という参考として使用

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

**パターンFirst: ファーストコンタクト（初回連絡用）**
```
突然のご連絡失礼いたします。
ベトナムにて人材サービスを提供しております、
キャリアリンクの佐藤と申します。

貴社のWebサイトを拝見し、
今後の採用活動の際にご参考になればと思い、
簡単ではございますが弊社サービスのご案内をお送りいたしました。

弊社では、
・条件に合う人材をご紹介する人材紹介サービス
・弊社運営の求人サイトへの求人掲載サービス
の2つを提供しております。

本メールはご案内のみでございますので、
採用をご検討される機会がございました場合には、
ご連絡いただけますと幸いです。

何卒よろしくお願い申し上げます。
```
※過去に連絡履歴がない企業への初回コンタクト用

**パターンVisited: 訪問後定期連絡**
```
お世話になっております。
キャリアリンクの佐藤でございます。

以前お打ち合わせの機会をいただいて以降、
定期的に近況のご連絡を差し上げております。

本日は、
現在の採用状況をお伺いするというよりも、
「必要なタイミングがあれば思い出していただければ」
という趣旨でご連絡いたしました。

弊社では、日系企業様向けに
ベトナム人材のご紹介を中心とした
成功報酬型の人材紹介サービスを行っております。

――――――――――
・紹介手数料：理論年収の20％（Gross月給 × 13か月）※ベトナム人の場合
・お支払い：試用期間終了後
――――――――――

現時点で特にご予定がなくても問題ございません。
今後、採用をご検討される機会や「まずは相談だけ」という段階でも、
お気軽にお声がけいただけましたら幸いです。

どうぞよろしくお願いいたします。
```
※「佐藤・訪問済」タグがある企業への定期連絡用

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
npx ts-node scripts/notify_slack.ts                        # テスト送信
npx tsx scripts/create_email_draft.ts ./drafts/xxx.json    # 下書き作成+通知（JSON入力）
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
| 18454 | アルプス システム インテグレーション株式会社 | junya.takei@alsi.co.jp | ✅ メール送信済み | タグ6月に更新済み |
| 18493 | Supremetech Co.,Ltd | info@supremetech.vn | ✅ メール送信済み | CRM Action 234597 |
| 18484 | Access Professional Vietnam | - | ❌ 誤処理（3月タグ） | CRM Action 234601 要削除 |
| 18265 | Vina Takeuchi Co.,LTD | info@v-takeuchi.vn | ✅ メール送信済み | CRM Action 234633 |
| 18072 | Vina Nide Co.,LTD | info@vinanide.com | ✅ メール送信済み | CRM Action 234635 |
| 18061 | LJTrading Co.,LTD | info@lj-worldwide.com | ✅ メール送信済み | CRM Action 234637（企業サイトでメール発見） |
| 17991 | Sankei Manufacturing Vietnam | n-kubota@ngo-sankei.co.jp | ✅ メール送信済み | CRM Action 234638（窪田様宛て）、タグ4月に更新済み |
| 17854 | Vietnam Shell Stone Co.,LTD | shellstonevietnam@gmail.com | ✅ メール送信済み | CRM Action 234639（貝原様宛て） |
| 17758 | Unifast Co.,Ltd | usukura@unifast.co.jp | ✅ メール送信済み | CRM Action 234640（臼倉様宛て、米良引き継ぎ） |
| 17681 | Daiichi Corporation Vietnam | w-murayama@daiichi-j.co.jp | ✅ メール送信済み | CRM Action 234641（Murayama様宛て）、タグ4月に更新済み |
| 17555 | Alpia Vietnam Co.,Ltd | satoshi-sato@jeicreate.net | ✅ メール送信済み | CRM Action 234642（企業サイトでメール発見） |
| 17529 | One Asia Lawyers Vietnam | fubito.yamamoto@oneasia.legal | ✅ メール送信済み | CRM Action 234643（山本様宛て、求人受領中・パターンC）、タグ4月に更新済み |
| 17478 | Matsusaka EDP Center Infotech Vietnam | recruit.vn@mec-infotech.com | ✅ メール送信済み | CRM Action 234644（柴原様宛て）、タグ6月に更新済み |
| 17420 | Arent Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234645（後藤様宛て、パターンB） |
| 17290 | Aria Vietnam Inc | 要確認 | ✅ 下書き作成済み | CRM Action 234646（別府様宛て、パターンA） |
| 17281 | HARIMA FC | naito.takeaki@nissin.vn | ✅ メール送信済み | CRM Action 234647（内藤様宛て）、タグ4月に更新済み |
| 17264 | NK LINKS VIET NAM | sato@tosmac-vietnam.com | ✅ メール送信済み | CRM Action 234648（佐藤様宛て、パターンA・サービス）、タグ4月に更新済み |
| 17255 | AVT INTERNATIONAL JSC | tan.van@avt.com.vn | ✅ メール送信済み | CRM Action 234649（Tan Van様宛て・英語）、タグ4月に更新済み |
| 17158 | Capco Vietnam | imazu01@central-auto.co.jp | ✅ メール送信済み | CRM Action 234651（今津様宛て、パターンA・訪問済み） |
| 17128 | TAKARA BELMONT COSMETICS | ui_akamine@takarabelmont.vn | ✅ メール送信済み | CRM Action 234652（赤嶺様宛て） |
| 17029 | VINEPRO | info@vinect-production.com | ✅ メール送信済み | CRM Action 234653（採用担当者様宛て、パターンA・広告）、タグ4月に更新済み |
| 16983 | Mercuria Vietnam | 要確認 | ✅ 下書き作成済み | CRM Action 234654（百田様宛て、パターンB・コンサル） |
| 16970 | TENNO ENGINEERING | ngan.dang_kayla@ce.com.vn | ✅ メール送信済み | CRM Action 234655（Ngan Dang様宛て・英語）、タグ4月に更新済み |
| 16908 | Maruyama Vietnam | atsutah@maruyama.co.jp | ✅ メール送信済み | CRM Action 234656（熱田様宛て）、タグ4月に更新済み |
| 16836 | Monorevo Vietnam | 要確認 | ✅ 下書き作成済み | CRM登録エラー（要手動登録）細井様宛て、パターンA・IT |
| 16065 | Tombow Manufacturing Asia | tanakaj@star.tombow.co.jp | ✅ 下書き作成済み | CRM Action 234810（田中様宛て、カスタムメール・製造） |
| 16775 | Matsumoto Precision Vietnam | a-sekiguchi@matsumoto-pre.co.jp | ✅ メール送信済み | 2025/11/17送信確認、タグ4月に更新済み（関口様宛て） |
| 16759 | Yoshimoto Mushroom Vietnam | minh.nguyen@ymush.com.vn | ✅ 下書き作成済み | CRM Action 234835（Minh様宛て、パターンB・マッシュルーム） |
| 16734 | Dover VN | son@doverseafoods.com | ✅ 下書き作成済み | CRM Action 234836（Mr. Son宛て、パターンEN・水産） |
| 16725 | MMK Vietnam | thaolinh-nguyen@mmknet.com | ✅ 下書き作成済み | CRM登録エラー（要手動登録）Thao Linh様宛て・英語 |
| 16658 | Blended Asia | t.tatsumi@blended-asia.com | ✅ 下書き作成済み | CRM Action 234838（辰巳様宛て、パターンB・コンサル） |
| 16564 | Scroll Vietnam | atsushi-izumi@scroll.vn | ✅ 下書き作成済み | CRM Action 234839（泉様宛て、パターンC・契約済み） |
| 16353 | Zuno Vietnam | komatsu@zuno.tv | ⏭️ スキップ | 2025/11/11連絡済み（3ヶ月以内）、タグ4月に更新済み |
| 16181 | KIREI NETWORK | y.hanaoka@kirei-network.com | ✅ 下書き作成済み | CRM登録エラー（要手動登録）花岡様宛て、パターンB・サービス |
| 16034 | TAGGER | miyamoto@tagger-vn.com | ✅ 下書き作成済み | CRM Action 234844（宮本様宛て、パターンB・広告） |
| 15366 | AMETHYST MEDICAL VIETNAM | ysugioka@amethyst.co.jp | ⏭️ スキップ | 求人受領中（2026/01/30連絡中）、タグ4月に更新済み |
| 15353 | SHOCHIKU | satoru_kamiyama@shochiku.co.jp | ✅ 下書き作成済み | CRM Action 234845（上山様宛て、パターンFirst・初回） |
| 15348 | TOTAI | yuki_to@totai.com | ⏭️ スキップ | 2025/12/12連絡済み（3ヶ月以内）、タグ4月に更新済み |
| 15335 | IBUKI INVESTMENT | info@ibuki.vn | ⏭️ スキップ | 2026/01/08連絡済み（3ヶ月以内）、タグ4月に更新済み |
| 15333 | CANVAS.ASIA | s.katayama@canvas-works.asia | ✅ 下書き作成済み | CRM Action 234846（片山様宛て、パターンVisited・訪問後定期連絡） |

### 未処理企業（次回継続）
| 企業ID | 企業名 | 備考 |
|--------|--------|------|
| - | 南部・1月連絡の残り企業を継続処理 | - |

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
