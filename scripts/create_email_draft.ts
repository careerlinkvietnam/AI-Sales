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
 */

// ========================================
// テンプレート定義
// ========================================

const TEMPLATES = {
  // パターンA: 製造業向け（日本語）
  manufacturing_ja: {
    name: '製造業向け（日本語）',
    body: `弊社では日系企業様向けに、製造管理や技術職、
品質管理など御社の業務内容に合った候補者のご紹介を数多く行っております。

「こんな人材がいたら相談したい」
「まずは市場の状況だけ知りたい」

といったご相談も歓迎しております。
お気軽にご連絡いただければ幸いです。

引き続きよろしくお願いいたします。`
  },

  // パターンB: 営業・事務向け（日本語）
  sales_admin_ja: {
    name: '営業・事務向け（日本語）',
    body: `弊社では日系企業様向けに、営業職や事務職、
その他御社の業務内容に合った候補者のご紹介を数多く行っております。

「こんな人材がいたら相談したい」
「まずは市場の状況だけ知りたい」

といったご相談も歓迎しております。
お気軽にご連絡いただければ幸いです。

引き続きよろしくお願いいたします。`
  },

  // パターンC: 英語
  general_en: {
    name: 'General (English)',
    body: `We specialize in recruiting for Japanese companies in Vietnam,
providing candidates for various positions including sales, administration,
engineering, and management roles.

We would be happy to discuss your hiring needs,
whether you have immediate requirements or are just exploring the market.

Please feel free to reach out at your convenience.

Best regards,`
  },

  // パターンD: 過去求人フォロー（日本語）
  past_job_followup_ja: {
    name: '過去求人フォロー（日本語）',
    body: `その後、採用活動のご状況はいかがでしょうか。

弊社では引き続き、御社のご要望に合った候補者のご紹介が可能でございます。
もし現在採用をご検討中でしたら、ぜひお気軽にご相談ください。

どうぞよろしくお願いいたします。`
  }
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

interface EmailDraftInput {
  // 必須項目
  companyId: string;
  companyName: string;
  recipientEmail: string;
  recipientName: string;        // 例: "小野寺様", "Mr. Tan"
  template: keyof typeof TEMPLATES;

  // カスタム段落（オプション）
  customParagraph?: string;     // 例: "前回10月に金型エンジニアをご提案しましたが、その後いかがでしょうか。"

  // 件名（オプション、デフォルトあり）
  subject?: string;

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

function generateEmailBody(input: EmailDraftInput): string {
  const template = TEMPLATES[input.template];
  const isEnglish = input.template.endsWith('_en');

  // 宛名
  const greeting = isEnglish
    ? `Dear ${input.recipientName},\n\n`
    : `${input.recipientName}\n\nお世話になっております。\nキャリアリンクの佐藤でございます。\n\n`;

  // カスタム段落（あれば）
  const customSection = input.customParagraph
    ? `${input.customParagraph}\n\n`
    : '';

  // テンプレート本文
  const templateBody = template.body;

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
  const subject = input.subject || (input.template.endsWith('_en')
    ? 'Recruitment Support - CareerLink Vietnam'
    : 'ご挨拶【キャリアリンク佐藤】');

  console.log('========================================');
  console.log('メール内容プレビュー');
  console.log('========================================');
  console.log('To:', input.recipientEmail);
  console.log('Subject:', subject);
  console.log('Template:', TEMPLATES[input.template].name);
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
          text: `Draft ID: \`${result.draftId}\` | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
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
  "template": "past_job_followup_ja",
  "customParagraph": "前回10月に金型エンジニア（日本語話者）をご提案させていただきましたが、その後いかがでしょうか。",
  "companySummary": "• トンボ鉛筆グループ製造会社\\n• 金型・組み立て",
  "actionSummary": "• 過去求人フォロー\\n• 前回: 2025/10 金型エンジニア提案",
  "contactHistory": {
    "visit": "佐藤訪問済",
    "phone": "不明",
    "email": "2025/10/08 金型エンジニア提案",
    "lastContact": "2025/10/08（メール）"
  },
  "hasPersonalEmail": true
}

有効なテンプレート:
  - manufacturing_ja    : 製造業向け（日本語）
  - sales_admin_ja      : 営業・事務向け（日本語）
  - general_en          : General (English)
  - past_job_followup_ja: 過去求人フォロー（日本語）
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
