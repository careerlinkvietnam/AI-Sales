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

// CLI usage: npx tsx scripts/notify_slack.ts <companyId> <companyName> <email> <recipientName> <subject> <details>
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 5) {
    console.log(`Usage: npx tsx scripts/notify_slack.ts <companyId> <companyName> <email> <recipientName> <subject> [details]

Example:
  npx tsx scripts/notify_slack.ts 16065 "Tombow Manufacturing" "onoderas@tombow-tma.com.vn" "小野寺様" "金型エンジニアご提案後のフォロー【キャリアリンク佐藤】" "詳細情報"
`);
    process.exit(1);
  }

  const [companyId, companyName, recipientEmail, recipientName, subject, details] = args;

  const info: DraftNotification = {
    companyName: companyName,
    companyId: companyId,
    crmUrl: `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`,
    recipientEmail: recipientEmail,
    subject: subject,
    draftId: 'N/A'
  };

  // Send detailed notification with custom message
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl && details) {
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
            text: `*企業:* ${companyName}\n*企業ID:* ${companyId}`
          }
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: details }
        },
        { type: 'divider' },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*宛先:*\n${recipientEmail}` },
            { type: 'mrkdwn', text: `*宛名:*\n${recipientName}` }
          ]
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*件名:*\n${subject}` }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*CRM:* <${info.crmUrl}|企業ページを開く>` }
        }
      ]
    };

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    }).then(res => {
      console.log(res.ok ? '[Slack] Notification sent successfully' : '[Slack] Failed');
      console.log('Test result:', res.ok ? 'Success' : 'Failed');
    }).catch(console.error);
  } else {
    notifyDraftCreated(info).then(success => {
      console.log('Test result:', success ? 'Success' : 'Failed');
    });
  }
}
