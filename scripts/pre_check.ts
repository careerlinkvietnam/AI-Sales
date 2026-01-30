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

  if (lines.length > 0) {
    console.log('  記載あり:');
    lines.forEach(line => console.log('    ' + line.trim()));

    if (lines.some(line => line.includes('送信済み'))) {
      console.log('  ⚠️ 送信済み → タグ更新のみ必要');
    } else if (lines.some(line => line.includes('下書き作成済み'))) {
      console.log('  ⚠️ 下書き作成済み → 送信確認が必要（タグ更新はまだ）');
      allPassed = false;
    }
  } else {
    console.log('  ✅ 未処理（記載なし）');
  }

  // Check 3: CRM URL表示
  console.log('\n□ チェック3: CRM確認');
  console.log('  企業名: ' + companyName);
  console.log('  CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/' + companyId);
  console.log('  ※ CRM画面でコールメモを目視確認してください');

  // 結果サマリー
  console.log('\n========================================');
  if (allPassed) {
    console.log('✅ チェック完了 - 処理を開始できます');
  } else {
    console.log('❌ チェック失敗 - 処理対象外または確認が必要です');
  }
  console.log('========================================');

  return allPassed;
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

preCheck(companyId, targetMonth).then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
