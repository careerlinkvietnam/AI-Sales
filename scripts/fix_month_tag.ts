import 'dotenv/config';
import { CrmClient } from '../src/connectors/crm/CrmClient';

/**
 * Fix month tag to specific month
 * Usage: npx tsx scripts/fix_month_tag.ts <companyId> <targetMonth> [region]
 * Example: npx tsx scripts/fix_month_tag.ts 16759 1
 * Example: npx tsx scripts/fix_month_tag.ts 16725 3 北部
 */

async function fixMonthTag(companyId: string, targetMonth: number, region?: string) {
  const crm = CrmClient.createFromEnv();

  console.log(`\n=== Fixing Month Tag for Company ${companyId} to ${targetMonth}月 ===\n`);

  const currentTags = await crm.getCompanyTags(companyId);
  console.log('Current tags:', currentTags.join(', '));

  // Find and replace month tag
  const monthTagPattern = /^(南部|北部|中部)・(\d{1,2})月連絡$/;
  let found = false;

  const newTags = currentTags.map(tag => {
    const match = tag.match(monthTagPattern);
    if (match) {
      const tagRegion = match[1];
      const oldMonth = match[2];
      // If region specified, only change that region's tag
      if (region && tagRegion !== region) {
        return tag;
      }
      found = true;
      console.log(`  Changing: ${tagRegion}・${oldMonth}月連絡 → ${tagRegion}・${targetMonth}月連絡`);
      return `${tagRegion}・${targetMonth}月連絡`;
    }
    return tag;
  });

  if (!found) {
    console.log('No month tag found');
    return;
  }

  await crm.updateCompanyTags(companyId, newTags);
  console.log('\n✅ Tag updated');
  console.log('New tags:', newTags.join(', '));
}

const companyId = process.argv[2];
const targetMonth = parseInt(process.argv[3] || '1', 10);
const region = process.argv[4]; // Optional: 南部, 北部, 中部

if (!companyId || isNaN(targetMonth)) {
  console.error('Usage: npx tsx scripts/fix_month_tag.ts <companyId> <targetMonth> [region]');
  console.error('Example: npx tsx scripts/fix_month_tag.ts 16759 1');
  console.error('Example: npx tsx scripts/fix_month_tag.ts 16725 3 北部');
  process.exit(1);
}

fixMonthTag(companyId, targetMonth, region).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
