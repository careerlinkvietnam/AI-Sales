import * as fs from 'fs';
import * as path from 'path';

interface SlackLogEntry {
  timestamp: string;
  companyId: string;
  companyName: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  crmUrl: string;
  draftId: string;
  hasPersonalEmail: boolean;
  companySummary: string;
  actionSummary: string;
  contactHistory: {
    visit: string;
    phone: string;
    email: string;
    lastContact: string;
  };
}

function listSlackNotifications() {
  const logPath = path.join(__dirname, '..', 'data', 'slack_notifications.ndjson');

  if (!fs.existsSync(logPath)) {
    console.log('ログファイルが存在しません:', logPath);
    console.log('\n今後 create_draft_and_notify.ts で送信すると自動的に記録されます。');
    return;
  }

  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line);

  if (lines.length === 0) {
    console.log('ログが空です。');
    return;
  }

  console.log(`=== Slack通知履歴（${lines.length}件）===\n`);

  const entries: SlackLogEntry[] = lines.map(line => JSON.parse(line));

  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const emailType = entry.hasPersonalEmail ? '個人' : '代表';

    console.log(`[${entry.companyId}] ${entry.companyName}`);
    console.log(`  日時: ${date}`);
    console.log(`  宛先: ${entry.recipientEmail} (${emailType})`);
    console.log(`  宛名: ${entry.recipientName}`);
    console.log(`  件名: ${entry.subject}`);
    console.log(`  CRM: ${entry.crmUrl}`);
    console.log('---');
  }

  // Summary
  console.log(`\n合計: ${entries.length}件`);
}

listSlackNotifications();
