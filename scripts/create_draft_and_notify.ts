import 'dotenv/config';
import { GmailClient } from '../src/connectors/gmail/GmailClient';

interface ContactHistory {
  visit: string;      // 訪問履歴（例: "2025/12/4 Ms. Sato Mai（武井様と面談）" または "なし"）
  phone: string;      // 電話履歴
  email: string;      // メール履歴
  lastContact: string; // 最終コンタクト（例: "2025/12/4（訪問）" または "なし（新規登録）"）
}

interface DraftInfo {
  companyId: string;
  companyName: string;
  crmUrl: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  companySummary: string;
  actionSummary: string;
  contactHistory: ContactHistory;
  hasPersonalEmail: boolean;
}

async function createDraftAndNotify(info: DraftInfo) {
  // 1. Create Gmail draft
  console.log('Creating Gmail draft...');
  const gmail = new GmailClient();
  const result = await gmail.createDraft(info.recipientEmail, info.subject, info.body);
  console.log('✅ Draft created:', result.draftId);

  // 2. Send Slack notification
  console.log('Sending Slack notification...');
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('❌ SLACK_WEBHOOK_URL not configured');
    return result;
  }

  const contactNote = info.hasPersonalEmail
    ? '✅ 担当者個人メール'
    : '⚠️ 代表メール（個人メールなし）';

  const message = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📧 下書き作成完了',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*企業:* ${info.companyName}\n*企業ID:* ${info.companyId}\n*連絡先:* ${contactNote}`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📋 会社概要:*\n${info.companySummary}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🎯 アクション:*\n${info.actionSummary}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📞 連絡履歴:*\n• 訪問: ${info.contactHistory.visit}\n• 電話: ${info.contactHistory.phone}\n• メール: ${info.contactHistory.email}\n• 最終コンタクト: ${info.contactHistory.lastContact}`
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*宛先:*\n${info.recipientEmail}`
          },
          {
            type: 'mrkdwn',
            text: `*宛名:*\n${info.recipientName}`
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*件名:*\n${info.subject}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*CRM:* <${info.crmUrl}|企業ページを開く>`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Draft ID: \`${result.draftId}\` | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
          }
        ]
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
  } else {
    console.log('❌ Slack notification failed:', response.status);
  }

  return result;
}

// Execute for NK LINKS VIET NAM (件名修正)
const draftInfo: DraftInfo = {
  companyId: '17264',
  companyName: 'NK LINKS VIET NAM CO.,LTD',
  crmUrl: 'https://www.careerlink.vn:1443/executive-search/vn/companies/17264',
  recipientEmail: 'sato@tosmac-vietnam.com',
  recipientName: '佐藤様',
  subject: '採用活動のご状況確認【キャリアリンク佐藤】',
  body: `NK LINKS VIET NAM CO.,LTD
佐藤様

ご無沙汰しております。
以前お伺いした際は大変お世話になりました。
キャリアリンクの佐藤でございます。

弊社では日系企業様向けに、サービススタッフやアシスタント、
その他御社の業務内容に合った候補者のご紹介を数多く行っております。

「こんな人材がいたら相談したい」
「まずは市場の状況だけ知りたい」

といったご相談も歓迎しております。
お気軽にご連絡いただければ幸いです。

引き続きよろしくお願いいたします。

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
Room 58S, 47 Sukhumvit 69 Rd., Phra Khanong Nuea, Watthana, Bangkok, Thailand`,
  companySummary: `• 日系企業（サービス・不動産・旅行）
• 佐藤・訪問済`,
  actionSummary: `• 件名修正版
• テンプレート: パターンA（サービススタッフ・アシスタント）`,
  contactHistory: {
    visit: '佐藤・訪問済（日付不明）',
    phone: 'なし',
    email: 'なし',
    lastContact: '訪問履歴あり'
  },
  hasPersonalEmail: true
};

createDraftAndNotify(draftInfo).then(() => {
  console.log('\n✅ 完了');
}).catch(err => {
  console.error('❌ Error:', err);
});
