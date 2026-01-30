import 'dotenv/config';

/**
 * スキップ通知スクリプト
 *
 * Usage:
 *   npx tsx scripts/notify_skip.ts <companyId> <companyName> <reason> <lastContactDate> <contactName> <email> [tagUpdate]
 *
 * Examples:
 *   # 求人受領中
 *   npx tsx scripts/notify_skip.ts 17529 "One Asia Lawyers Vietnam" "求人受領中" "2025/07/11" "山本様" "fubito.yamamoto@oneasia.legal" "1月→4月"
 *
 *   # 過去求人受領・3ヶ月以内
 *   npx tsx scripts/notify_skip.ts 17991 "Sankei Manufacturing Vietnam" "過去求人受領・3ヶ月以内に連絡済み" "2025/11/05" "窪田様" "n-kubota@ngo-sankei.co.jp"
 */

interface SkipInfo {
  companyId: string;
  companyName: string;
  reason: string;
  lastContactDate: string;
  contactName: string;
  email: string;
  tagUpdate?: string; // e.g., "1月→4月"
}

async function sendSkipNotification(info: SkipInfo) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('❌ SLACK_WEBHOOK_URL not configured');
    return;
  }

  const crmUrl = `https://www.careerlink.vn:1443/executive-search/vn/companies/${info.companyId}`;

  let message = `🔴 スキップ: ${info.companyName} (${info.companyId})
理由: ${info.reason}
最終連絡: ${info.lastContactDate} ${info.contactName} (${info.email})`;

  if (info.tagUpdate) {
    message += `\nタグ更新: 南部・${info.tagUpdate}連絡`;
  }

  message += `\nCRM: ${crmUrl}`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message })
  });

  if (response.ok) {
    console.log('✅ Slack通知送信完了');
    console.log('\n送信内容:');
    console.log(message);
  } else {
    console.log('❌ Slack通知失敗:', response.status);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 6) {
  console.log(`Usage: npx tsx scripts/notify_skip.ts <companyId> <companyName> <reason> <lastContactDate> <contactName> <email> [tagUpdate]

Examples:
  # 求人受領中（タグ更新あり）
  npx tsx scripts/notify_skip.ts 17529 "One Asia Lawyers Vietnam" "求人受領中のためメール不要" "2025/07/11" "山本様" "fubito.yamamoto@oneasia.legal" "1月→4月"

  # 過去求人受領（タグ更新なし）
  npx tsx scripts/notify_skip.ts 17991 "Sankei Manufacturing Vietnam" "過去求人受領・3ヶ月以内に連絡済み" "2025/11/05" "窪田様" "n-kubota@ngo-sankei.co.jp"
`);
  process.exit(1);
}

const skipInfo: SkipInfo = {
  companyId: args[0],
  companyName: args[1],
  reason: args[2],
  lastContactDate: args[3],
  contactName: args[4],
  email: args[5],
  tagUpdate: args[6] || undefined
};

sendSkipNotification(skipInfo).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
