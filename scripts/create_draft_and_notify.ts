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

// Execute for Vietnam Shell Stone
const draftInfo: DraftInfo = {
  companyId: '17854',
  companyName: 'Vietnam Shell Stone Co.,LTD',
  crmUrl: 'https://www.careerlink.vn:1443/executive-search/vn/companies/17854',
  recipientEmail: 'shellstonevietnam@gmail.com',
  recipientName: '貝原様',
  subject: '採用状況のご確認【キャリアリンク佐藤】',
  body: `Vietnam Shell Stone
貝原様

お世話になっております。
キャリアリンクの佐藤でございます。

その後、採用活動のご状況はいかがでしょうか。

もし現在採用をご検討中のポジションがございましたら、
お気軽にご相談ください。

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
  companySummary: `• 日系企業（シェルストーン）
• ホテル・レストラン向け業務用食器、備品
• 商品企画、開発、生産管理、品質管理`,
  actionSummary: `• 定期フォロー（5ヶ月ぶり）
• 前回: 2025-08-14 Ms. Sato Mai
• テンプレート: パターン4（シンプル状況確認）`,
  contactHistory: {
    visit: 'なし',
    phone: 'なし',
    email: 'なし',
    lastContact: '2025-08-14（Ms. Sato Mai）'
  },
  hasPersonalEmail: true
};

createDraftAndNotify(draftInfo).then(() => {
  console.log('\n✅ 完了');
}).catch(err => {
  console.error('❌ Error:', err);
});
