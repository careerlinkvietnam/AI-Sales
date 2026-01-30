import 'dotenv/config';
import { GmailClient } from '../src/connectors/gmail/GmailClient';
import * as fs from 'fs';
import * as path from 'path';

/**
 * メール下書き作成スクリプト（テンプレート + カスタム段落）
 *
 * Usage:
 *   npx tsx scripts/create_email_draft.ts <jsonファイルパス>
 *
 * Example:
 *   npx tsx scripts/create_email_draft.ts ./drafts/16065_tombow.json
 *
 * テンプレート:
 *   - pattern_a: パターンA - 具体的な価値を伝える
 *   - pattern_b: パターンB - シンプルに親しみやすく
 *   - pattern_c: パターンC - 求人受領中クライアント向け
 *   - pattern_en: 英語版
 */

// ========================================
// テンプレート定義（SESSION_HANDOFF.mdと統一）
// ========================================

const TEMPLATES = {
  // パターンA: 具体的な価値を伝える
  pattern_a: {
    name: 'パターンA: 具体的な価値を伝える',
    body: `弊社では日系企業様向けに、{職種}、その他御社の業務内容に
合った候補者のご紹介を数多く行っております。

「こんな人材がいたら相談したい」
「まずは市場の状況だけ知りたい」

といったご相談も歓迎しております。
お気軽にご連絡いただければ幸いです。

引き続きよろしくお願いいたします。`
  },

  // パターンB: シンプルに親しみやすく
  pattern_b: {
    name: 'パターンB: シンプルに親しみやすく',
    body: `弊社では{職種}、その他御社の業務内容に合った
候補者のご紹介が可能です。

もし採用についてお困りのことがあれば、
お気軽にご相談ください。

「まだ具体的ではないけど、ちょっと話を聞きたい」
というご連絡も大歓迎です。

引き続きよろしくお願いいたします。`
  },

  // パターンC: 求人受領中クライアント向け
  pattern_c: {
    name: 'パターンC: 求人受領中クライアント向け',
    body: `現在いただいている求人状況について、
変更などはございませんでしょうか？

追加のご要望などございましたら、
お気軽にお申し付けください。

引き続きよろしくお願いいたします。`
  },

  // 英語版
  pattern_en: {
    name: 'Pattern (English)',
    body: `We specialize in recruiting for Japanese companies in Vietnam,
providing candidates for various positions including {jobTypes}.

We would be happy to discuss your hiring needs,
whether you have immediate requirements or are just exploring the market.

Please feel free to reach out at your convenience.

Best regards,`
  }
};

// 職種カスタマイズルール
const JOB_TYPES_BY_INDUSTRY: Record<string, string> = {
  'IT': 'ITエンジニア、SE、プログラマー',
  'オフショア': 'ITエンジニア、SE、プログラマー',
  '製造': '生産管理、品質管理、技術者',
  '工場': '生産管理、品質管理、技術者',
  'メーカー': '営業、営業事務、貿易事務',
  '商社': '営業、営業事務、貿易事務',
  '建設': '施工管理、現場監督、CADオペレーター',
  '物流': '物流管理、倉庫管理、通関士',
  '倉庫': '物流管理、倉庫管理、通関士',
  'コンサル': 'コンサルタント、アシスタント',
  'サービス': 'コンサルタント、アシスタント',
  '法務': '法務担当、経理、会計スタッフ',
  '会計': '法務担当、経理、会計スタッフ',
  '飲食': '店長候補、サービススタッフ',
  '金型': '金型設計、金型エンジニア、製造技術者',
  '一般': '日本語人材・バイリンガル人材'
};

// 英語版職種
const JOB_TYPES_EN_BY_INDUSTRY: Record<string, string> = {
  'IT': 'IT engineers, developers, and programmers',
  'manufacturing': 'production management, quality control, and technical staff',
  'trading': 'sales, trading, and administrative positions',
  'construction': 'construction management, site supervisors, and CAD operators',
  'logistics': 'logistics management, warehouse management, and customs specialists',
  'consulting': 'consultants and administrative assistants',
  'general': 'Japanese-speaking and bilingual professionals'
};

const SIGNATURE_JA = `
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
8th Floor, ACB Da Nang Tower, 218 Bach Dang St, Hai Chau Ward, Da Nang City`;

const SIGNATURE_EN = `
--
CareerLink Co., Ltd.
Ms. Mai Sato
Mobile: (+84)091-140-1961
Tel: 028-3812-7983
HR-Website: https://www.CareerLink.vn
License: 31116/SLDTBXH-GPGH`;

// ========================================
// 型定義
// ========================================

type GreetingType = 'standard' | 'visited_recent' | 'visited_1to3months' | 'visited_3to6months' | 'visited_over6months' | 'visited_unknown';

interface EmailDraftInput {
  // 必須項目
  companyId: string;
  companyName: string;
  recipientEmail: string;
  recipientName: string;        // 例: "小野寺様", "Mr. Tan"
  template: keyof typeof TEMPLATES;

  // 職種（パターンA/Bで使用）
  industry?: string;            // 業種キーワード（例: "製造", "IT", "コンサル"）
  jobTypes?: string;            // 直接指定する場合（例: "金型エンジニア、製造技術者"）

  // カスタム段落（オプション）- 挨拶の後、テンプレートの前に挿入
  customParagraph?: string;     // 例: "前回10月に金型エンジニアをご提案しましたが、その後いかがでしょうか。"

  // 挨拶タイプ
  greeting?: GreetingType;      // デフォルト: 'standard'

  // 件名（オプション）
  subject?: string;             // 指定なしの場合、状況に応じて自動設定

  // Slack通知用メタデータ
  companySummary: string;       // 会社概要（箇条書き）
  actionSummary: string;        // アクション内容
  contactHistory: {
    visit: string;
    phone: string;
    email: string;
    lastContact: string;
  };
  hasPersonalEmail: boolean;
}

// ========================================
// メール本文生成
// ========================================

function getGreeting(type: GreetingType, recipientName: string, isEnglish: boolean): string {
  if (isEnglish) {
    return `Dear ${recipientName},\n\n`;
  }

  const greetings: Record<GreetingType, string> = {
    'standard': 'お世話になっております。',
    'visited_recent': '先日はお時間をいただきありがとうございました。',
    'visited_1to3months': 'お世話になっております。',
    'visited_3to6months': 'ご無沙汰しております。',
    'visited_over6months': '大変ご無沙汰しております。',
    'visited_unknown': 'ご無沙汰しております。以前お伺いした際は大変お世話になりました。'
  };

  return `${recipientName}\n\n${greetings[type]}\nキャリアリンクの佐藤でございます。\n\n`;
}

function getJobTypes(input: EmailDraftInput): string {
  // 直接指定があればそれを使用
  if (input.jobTypes) {
    return input.jobTypes;
  }

  // 業種から職種を取得
  if (input.industry) {
    const industry = input.industry;
    for (const [key, value] of Object.entries(JOB_TYPES_BY_INDUSTRY)) {
      if (industry.includes(key)) {
        return value;
      }
    }
  }

  // デフォルト
  return JOB_TYPES_BY_INDUSTRY['一般'];
}

function getJobTypesEn(input: EmailDraftInput): string {
  if (input.jobTypes) {
    return input.jobTypes;
  }

  if (input.industry) {
    const industry = input.industry.toLowerCase();
    for (const [key, value] of Object.entries(JOB_TYPES_EN_BY_INDUSTRY)) {
      if (industry.includes(key)) {
        return value;
      }
    }
  }

  return JOB_TYPES_EN_BY_INDUSTRY['general'];
}

function getDefaultSubject(input: EmailDraftInput): string {
  const isEnglish = input.template === 'pattern_en';

  if (isEnglish) {
    return 'Recruitment Support - CareerLink Vietnam';
  }

  // 求人受領中
  if (input.template === 'pattern_c') {
    return '採用活動のご状況確認【キャリアリンク佐藤】';
  }

  // 訪問済み
  if (input.greeting && input.greeting !== 'standard') {
    return '採用活動のご状況確認【キャリアリンク佐藤】';
  }

  // 初回コンタクト
  return 'ご挨拶【キャリアリンク佐藤】';
}

function generateEmailBody(input: EmailDraftInput): string {
  const template = TEMPLATES[input.template];
  const isEnglish = input.template === 'pattern_en';

  // 挨拶
  const greetingType = input.greeting || 'standard';
  const greeting = getGreeting(greetingType, input.recipientName, isEnglish);

  // カスタム段落（あれば）
  const customSection = input.customParagraph
    ? `${input.customParagraph}\n\n`
    : '';

  // テンプレート本文（職種を置換）
  let templateBody = template.body;
  if (isEnglish) {
    templateBody = templateBody.replace('{jobTypes}', getJobTypesEn(input));
  } else {
    templateBody = templateBody.replace('{職種}', getJobTypes(input));
  }

  // 署名
  const signature = isEnglish ? SIGNATURE_EN : SIGNATURE_JA;

  return greeting + customSection + templateBody + signature;
}

// ========================================
// 下書き作成 + Slack通知
// ========================================

async function createDraftAndNotify(input: EmailDraftInput) {
  // 入力検証
  if (!input.companyId || !input.recipientEmail || !input.recipientName || !input.template) {
    throw new Error('必須項目が不足しています: companyId, recipientEmail, recipientName, template');
  }

  if (!TEMPLATES[input.template]) {
    throw new Error(`無効なテンプレート: ${input.template}\n有効なテンプレート: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  // メール本文生成
  const body = generateEmailBody(input);
  const subject = input.subject || getDefaultSubject(input);

  console.log('========================================');
  console.log('メール内容プレビュー');
  console.log('========================================');
  console.log('To:', input.recipientEmail);
  console.log('Subject:', subject);
  console.log('Template:', TEMPLATES[input.template].name);
  if (input.industry) console.log('Industry:', input.industry);
  if (input.jobTypes) console.log('JobTypes:', input.jobTypes);
  if (input.greeting) console.log('Greeting:', input.greeting);
  console.log('');
  console.log('--- 本文 ---');
  console.log(body);
  console.log('========================================\n');

  // 1. Gmail下書き作成
  console.log('Creating Gmail draft...');
  const gmail = new GmailClient();
  const result = await gmail.createDraft(input.recipientEmail, subject, body);
  console.log('✅ Draft created:', result.draftId);

  // 2. Slack通知
  console.log('Sending Slack notification...');
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('❌ SLACK_WEBHOOK_URL not configured');
    return result;
  }

  const crmUrl = `https://www.careerlink.vn:1443/executive-search/vn/companies/${input.companyId}`;
  const contactNote = input.hasPersonalEmail
    ? '✅ 担当者個人メール'
    : '⚠️ 代表メール（個人メールなし）';

  const message = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📧 下書き作成完了', emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*企業:* ${input.companyName}\n*企業ID:* ${input.companyId}\n*連絡先:* ${contactNote}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*📋 会社概要:*\n${input.companySummary}` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*🎯 アクション:*\n${input.actionSummary}` }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📞 連絡履歴:*\n• 訪問: ${input.contactHistory.visit}\n• 電話: ${input.contactHistory.phone}\n• メール: ${input.contactHistory.email}\n• 最終コンタクト: ${input.contactHistory.lastContact}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*宛先:*\n${input.recipientEmail}` },
          { type: 'mrkdwn', text: `*宛名:*\n${input.recipientName}` }
        ]
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*件名:*\n${subject}` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*CRM:* <${crmUrl}|企業ページを開く>` }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `Draft ID: \`${result.draftId}\` | Template: ${input.template} | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
        }]
      }
    ]
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });

  if (response.ok) {
    console.log('✅ Slack notification sent');

    // ログ保存
    const logEntry = {
      timestamp: new Date().toISOString(),
      companyId: input.companyId,
      companyName: input.companyName,
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      subject: subject,
      template: input.template,
      industry: input.industry || null,
      jobTypes: input.jobTypes || null,
      greeting: input.greeting || 'standard',
      customParagraph: input.customParagraph || null,
      crmUrl: crmUrl,
      draftId: result.draftId,
      hasPersonalEmail: input.hasPersonalEmail,
      companySummary: input.companySummary,
      actionSummary: input.actionSummary,
      contactHistory: input.contactHistory
    };

    const logPath = path.join(__dirname, '..', 'data', 'slack_notifications.ndjson');
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    console.log('✅ Logged to', logPath);
  } else {
    console.log('❌ Slack notification failed:', response.status);
  }

  return result;
}

// ========================================
// メイン処理
// ========================================

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.log(`
Usage: npx tsx scripts/create_email_draft.ts <jsonファイルパス>

JSONファイル形式:
{
  "companyId": "16065",
  "companyName": "Tombow Manufacturing Asia Co., Ltd.",
  "recipientEmail": "onoderas@tombow-tma.com.vn",
  "recipientName": "小野寺様",
  "template": "pattern_a",
  "industry": "金型",
  "customParagraph": "前回10月に金型エンジニア（日本語話者）をご提案させていただきましたが、その後いかがでしょうか。",
  "greeting": "standard",
  "companySummary": "• トンボ鉛筆グループ製造会社\\n• 金型・組み立て",
  "actionSummary": "• 過去求人フォロー\\n• 前回: 2025/10 金型エンジニア提案\\n• テンプレート: パターンA",
  "contactHistory": {
    "visit": "佐藤訪問済",
    "phone": "不明",
    "email": "2025/10/08 金型エンジニア提案",
    "lastContact": "2025/10/08（メール）"
  },
  "hasPersonalEmail": true
}

テンプレート:
  - pattern_a : パターンA - 具体的な価値を伝える（{職種}を業種に応じて変更）
  - pattern_b : パターンB - シンプルに親しみやすく（{職種}を業種に応じて変更）
  - pattern_c : パターンC - 求人受領中クライアント向け
  - pattern_en: 英語版

挨拶タイプ (greeting):
  - standard           : お世話になっております（デフォルト）
  - visited_recent     : 先日はお時間をいただきありがとうございました（訪問1ヶ月以内）
  - visited_1to3months : お世話になっております（訪問1〜3ヶ月）
  - visited_3to6months : ご無沙汰しております（訪問3〜6ヶ月）
  - visited_over6months: 大変ご無沙汰しております（訪問6ヶ月以上）
  - visited_unknown    : ご無沙汰しております。以前お伺いした際は...（訪問日不明）

業種キーワード (industry):
  IT, オフショア, 製造, 工場, メーカー, 商社, 建設, 物流, 倉庫,
  コンサル, サービス, 法務, 会計, 飲食, 金型, 一般

※ パターンA/Bは交互に使用すること（テンプレート感を減らすため）
`);
  process.exit(1);
}

// JSONファイル読み込み
if (!fs.existsSync(jsonPath)) {
  console.error(`❌ ファイルが見つかりません: ${jsonPath}`);
  process.exit(1);
}

const input: EmailDraftInput = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

createDraftAndNotify(input).then(() => {
  console.log('\n✅ 完了');
}).catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
