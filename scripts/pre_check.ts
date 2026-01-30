import 'dotenv/config';
import { CrmClient } from '../src/connectors/crm/CrmClient';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 企業処理前の必須チェックスクリプト
 *
 * Usage: npx tsx scripts/pre_check.ts <companyId> <targetMonth>
 * Example: npx tsx scripts/pre_check.ts 16970 1
 *
 * ★重要★ このスクリプトを実行してからでないと、企業処理を開始してはいけない
 */

// Gmail送信履歴を確認
async function checkGmailSent(email: string): Promise<{ sent: boolean; date?: string; subject?: string }> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { sent: false };
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    const query = encodeURIComponent(`in:sent to:${email}`);
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await res.json() as { messages?: Array<{ id: string }> };

    if (!data.messages || data.messages.length === 0) {
      return { sent: false };
    }

    // Get the latest email details
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${data.messages[0].id}?format=metadata&metadataHeaders=Date&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const msgData = await msgRes.json() as {
      payload?: { headers?: Array<{ name: string; value: string }> };
    };

    const headers = msgData.payload?.headers || [];
    const date = headers.find(h => h.name === 'Date')?.value;
    const subject = headers.find(h => h.name === 'Subject')?.value;

    return { sent: true, date, subject };
  } catch {
    return { sent: false };
  }
}

async function preCheck(companyId: string, targetMonth: number) {
  console.log('========================================');
  console.log(`企業 ${companyId} 処理前チェック（対象: ${targetMonth}月連絡）`);
  console.log('========================================\n');

  const client = CrmClient.createFromEnv();
  let allPassed = true;

  // Check 1: CRMタグ確認
  console.log('□ チェック1: CRMタグ確認');
  let companyName = '';
  try {
    const tags = await client.getCompanyTags(companyId);
    const monthTag = tags.find(t => t.match(/・\d+月連絡/));
    const monthMatch = monthTag?.match(/・(\d+)月連絡/);
    const actualMonth = monthMatch ? parseInt(monthMatch[1], 10) : null;

    console.log('  現在のタグ: ' + tags.join(', '));
    console.log('  月タグ: ' + (monthTag || 'なし'));

    if (actualMonth === targetMonth) {
      console.log(`  ✅ 対象月(${targetMonth}月)と一致`);
    } else {
      console.log(`  ❌ 対象月(${targetMonth}月)と不一致 → 処理対象外`);
      allPassed = false;
    }

    // Get company name
    const detail = await client.getCompanyDetail(companyId);
    companyName = detail.name;
  } catch (err: any) {
    console.log('  ❌ エラー: ' + err.message);
    allPassed = false;
  }

  // Check 2: SESSION_HANDOFF.md確認
  console.log('\n□ チェック2: SESSION_HANDOFF.md確認');
  const handoffPath = path.join(__dirname, '..', 'docs', 'SESSION_HANDOFF.md');
  const handoffContent = fs.readFileSync(handoffPath, 'utf-8');

  const companyIdPattern = new RegExp('\\|\\s*' + companyId + '\\s*\\|');
  const lines = handoffContent.split('\n').filter(line => companyIdPattern.test(line));

  let emailFromRecord = '';
  let isDraftCreated = false;
  let isSent = false;

  if (lines.length > 0) {
    console.log('  記載あり:');
    lines.forEach(line => console.log('    ' + line.trim()));

    // Extract email from record
    const emailMatch = lines[0].match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      emailFromRecord = emailMatch[1];
    }

    if (lines.some(line => line.includes('送信済み'))) {
      console.log('  ⚠️ 送信済み → タグ更新のみ必要');
      isSent = true;
    } else if (lines.some(line => line.includes('下書き作成済み'))) {
      isDraftCreated = true;
    }
  } else {
    console.log('  ✅ 未処理（記載なし）');
  }

  // Check 3: Gmail送信確認（下書き作成済みの場合は自動で確認）
  console.log('\n□ チェック3: Gmail送信確認');
  if (isDraftCreated && emailFromRecord) {
    console.log('  メールアドレス: ' + emailFromRecord);
    const gmailResult = await checkGmailSent(emailFromRecord);
    if (gmailResult.sent) {
      console.log('  ✅ 送信済み');
      console.log('    日時: ' + gmailResult.date);
      console.log('    件名: ' + gmailResult.subject);
      console.log('  → タグ更新可能');
      isSent = true;
    } else {
      console.log('  ❌ 未送信（下書きのまま）');
      console.log('  → タグ更新不可、新規処理も不要');
      allPassed = false;
    }
  } else if (isDraftCreated) {
    console.log('  ⚠️ メールアドレス不明のため手動確認が必要');
    allPassed = false;
  } else if (isSent) {
    console.log('  ✅ 送信済み（記録より）');
  } else {
    console.log('  - 未処理のため確認不要');
  }

  // Check 4: CRM URL表示
  console.log('\n□ チェック4: CRM情報');
  console.log('  企業名: ' + companyName);
  console.log('  CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/' + companyId);

  // 結果サマリー
  console.log('\n========================================');
  if (isSent && !allPassed) {
    // 送信済みだがタグが対象月のまま → タグ更新が必要
    console.log('⚠️ 送信済み・タグ更新が必要');
    console.log('  → npx tsx scripts/update_month_tag.ts ' + companyId);
  } else if (allPassed) {
    console.log('✅ チェック完了 - 処理を開始できます');
  } else {
    console.log('❌ チェック失敗 - 処理対象外または確認が必要です');
  }
  console.log('========================================');

  return { passed: allPassed, isSent };
}

// Main
const companyId = process.argv[2];
const targetMonth = parseInt(process.argv[3] || '1', 10);

if (!companyId) {
  console.log(`
Usage: npx tsx scripts/pre_check.ts <companyId> <targetMonth>

Example: npx tsx scripts/pre_check.ts 16970 1

★重要★
このスクリプトは企業処理前に必ず実行すること。
チェックに通らない場合は処理を開始してはいけない。
`);
  process.exit(1);
}

preCheck(companyId, targetMonth).then(result => {
  process.exit(result.passed ? 0 : 1);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
