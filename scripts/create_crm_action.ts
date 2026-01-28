import 'dotenv/config';
import { CrmClient } from '../src/connectors/crm/CrmClient';

/**
 * CRMにコールメモ（Tel Action）を登録するスクリプト
 *
 * 使用方法:
 *   npx ts-node scripts/create_crm_action.ts <会社ID> <対応者名> <メモ> [オフィス名]
 *
 * 例:
 *   npx ts-node scripts/create_crm_action.ts 18454 "武井 順也" "状況確認のメールを送信" "日本本社"
 *   npx ts-node scripts/create_crm_action.ts 18493 "採用担当者" "初回コンタクトメール送信"
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log('使用方法: npx ts-node scripts/create_crm_action.ts <会社ID> <対応者名> <メモ> [オフィス名]');
    console.log('');
    console.log('例:');
    console.log('  npx ts-node scripts/create_crm_action.ts 18454 "武井 順也" "状況確認のメールを送信" "日本本社"');
    console.log('  npx ts-node scripts/create_crm_action.ts 18493 "採用担当者" "初回コンタクトメール送信"');
    process.exit(1);
  }

  const [companyId, staffName, log, place] = args;

  console.log('=== CRM コールメモ登録 ===');
  console.log(`会社ID: ${companyId}`);
  console.log(`対応者: ${staffName}`);
  console.log(`メモ: ${log}`);
  if (place) {
    console.log(`オフィス: ${place}`);
  }
  console.log('');

  try {
    const client = CrmClient.createFromEnv();

    console.log('CRMに接続中...');
    const result = await client.createTelAction(companyId, staffName, log, place);

    console.log('');
    console.log('✅ 登録完了!');
    console.log(`Action ID: ${result.id}`);
    console.log(`登録日時: ${result.performedAt}`);
    console.log('');
    console.log(`CRM確認: https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`);
  } catch (error) {
    console.error('❌ エラー:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
