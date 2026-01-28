import 'dotenv/config';

interface DraftNotification {
  companyName: string;
  companyId: string;
  crmUrl: string;
  recipientEmail: string;
  subject: string;
  draftId: string;
}

/**
 * Send a Slack notification about a created draft
 */
export async function notifyDraftCreated(info: DraftNotification): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('[Slack] SLACK_WEBHOOK_URL not configured, skipping notification');
    return false;
  }

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
        fields: [
          {
            type: 'mrkdwn',
            text: `*企業:*\n${info.companyName}`
          },
          {
            type: 'mrkdwn',
            text: `*企業ID:*\n${info.companyId}`
          }
        ]
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
            text: `*件名:*\n${info.subject}`
          }
        ]
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
            text: `Draft ID: \`${info.draftId}\` | ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (response.ok) {
      console.log('[Slack] Notification sent successfully');
      return true;
    } else {
      console.error('[Slack] Failed to send notification:', response.status);
      return false;
    }
  } catch (error) {
    console.error('[Slack] Error sending notification:', error);
    return false;
  }
}

// CLI test
if (require.main === module) {
  const testInfo: DraftNotification = {
    companyName: 'アルプス システム インテグレーション株式会社',
    companyId: '18454',
    crmUrl: 'https://www.careerlink.vn:1443/executive-search/vn/companies/18454',
    recipientEmail: 'junya.takei@alsi.co.jp',
    subject: '先日のご面談のお礼とご状況確認',
    draftId: 'r-7641259842320052611'
  };

  notifyDraftCreated(testInfo).then(success => {
    console.log('Test result:', success ? 'Success' : 'Failed');
  });
}
