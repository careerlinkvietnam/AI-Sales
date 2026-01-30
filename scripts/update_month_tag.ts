import 'dotenv/config';
import { CrmClient } from '../src/connectors/crm/CrmClient';

/**
 * Update company month tag (adds 3 months)
 *
 * Usage: npx tsx scripts/update_month_tag.ts <companyId>
 *
 * Example:
 *   npx tsx scripts/update_month_tag.ts 16811
 *   -> Changes "南部・1月連絡" to "南部・4月連絡"
 */

async function updateMonthTag(companyId: string) {
  const crm = CrmClient.createFromEnv();

  console.log(`\n=== Updating Month Tag for Company ${companyId} ===\n`);

  const result = await crm.updateMonthTag(companyId);

  if (!result) {
    console.log('❌ No month tag found (expected pattern: 南部・X月連絡)');
    return;
  }

  console.log(`✅ Tag updated:`);
  console.log(`   ${result.oldTag} → ${result.newTag}`);
  console.log(`\n   All tags: ${result.allTags.join(', ')}`);
}

const companyId = process.argv[2];
if (!companyId) {
  console.error('Usage: npx tsx scripts/update_month_tag.ts <companyId>');
  process.exit(1);
}

updateMonthTag(companyId).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
