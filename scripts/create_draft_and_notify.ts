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

// Execute for LJTrading
const draftInfo: DraftInfo = {
  companyId: '18061',
  companyName: 'LJTrading Co.,LTD Ho Chi Minh Representative Office',
  crmUrl: 'https://www.careerlink.vn:1443/executive-search/vn/companies/18061',
  recipientEmail: 'info@lj-worldwide.com',
  recipientName: '採用ご担当者様',
  subject: 'ご挨拶【キャリアリンク佐藤】',
  body: `LJTrading株式会社
採用ご担当者様

初めてご連絡させていただきます。
キャリアリンクの佐藤と申します。

弊社はベトナムにて人材紹介サービスを提供しております。
貴社のベトナム駐在員事務所について、
将来的な採用のご予定がございましたら
お手伝いできればと思いご連絡いたしました。

弊社では【人材紹介サービス】と【Webリクルーティングサービス】の
2つのサービスを提供しております。

・人材紹介サービス: 日本語・英語人材、管理職人材のご紹介
・Webリクルーティング: 求人広告の掲載・運用

もしご関心がございましたら、お気軽にお知らせください。

何卒よろしくお願いいたします。

キャリアリンク
佐藤`,
  companySummary: `• 日系企業（千葉県佐倉市本社）
• 商社・メーカー
• ベトナム・駐在員事務所`,
  actionSummary: `• 初回コンタクト
• テンプレート: パターン5ベース（ご挨拶）
• 企業サイトでメール発見（CRM連絡先不明タグあり）`,
  contactHistory: {
    visit: 'なし',
    phone: 'なし',
    email: 'なし',
    lastContact: 'なし（未コンタクト）'
  },
  hasPersonalEmail: false
};

createDraftAndNotify(draftInfo).then(() => {
  console.log('\n✅ 完了');
}).catch(err => {
  console.error('❌ Error:', err);
});
