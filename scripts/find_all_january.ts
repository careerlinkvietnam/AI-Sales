import 'dotenv/config';
import https from 'https';
import { URL } from 'url';

const agent = new https.Agent({ rejectUnauthorized: false });

interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface CompanyInfo {
  id: string;
  name: string;
  tags: string[];
  hasEmail: boolean;
  emails: string[];
}

async function fetchWithCookies(url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<FetchResult> {
  const urlObj = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers as Record<string, string | string[] | undefined>,
        body: data
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function main() {
  console.log('ログイン中...');

  // Login
  const loginPage = await fetchWithCookies('https://www.careerlink.vn:1443/siankaan0421/login');
  const csrfMatch = loginPage.body.match(/name="authenticity_token"[^>]*value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const setCookies = loginPage.headers['set-cookie'];
  const cookies1 = Array.isArray(setCookies)
    ? setCookies.map(c => c.split(';')[0]).join('; ')
    : '';

  const loginBody = '_username=' + encodeURIComponent(process.env.CRM_LOGIN_EMAIL || '') +
    '&_password=' + encodeURIComponent(process.env.CRM_LOGIN_PASSWORD || '') +
    '&authenticity_token=' + encodeURIComponent(csrf);

  const loginRes = await fetchWithCookies('https://www.careerlink.vn:1443/siankaan0421/login_check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies1 },
    body: loginBody
  });

  const newSetCookies = loginRes.headers['set-cookie'];
  const newCookies = Array.isArray(newSetCookies)
    ? newSetCookies.map(c => c.split(';')[0]).join('; ')
    : '';
  const sessionCookie = newCookies || cookies1;

  const tag = process.argv[2] || '南部・1月連絡';
  const checkDetails = process.argv[3] === '--details';

  console.log(`タグ検索: ${tag}`);
  console.log('全ページを取得中...\n');

  const allCompanyIds = new Set<string>();
  let page = 1;
  let hasMore = true;

  // Get all company IDs
  while (hasMore) {
    const encodedTag = encodeURIComponent(tag);
    const url = `https://www.careerlink.vn:1443/executive-search/vn/companies/tags?tags=${encodedTag}&page=${page}`;

    const res = await fetchWithCookies(url, { headers: { 'Cookie': sessionCookie } });

    const companyPattern = /\/companies\/(\d+)/g;
    let match;
    let pageCount = 0;
    while ((match = companyPattern.exec(res.body)) !== null) {
      if (!allCompanyIds.has(match[1])) {
        allCompanyIds.add(match[1]);
        pageCount++;
      }
    }

    process.stdout.write(`\rPage ${page}: 累計 ${allCompanyIds.size} 企業`);

    const nextPagePattern = new RegExp(`page=${page + 1}`);
    if (nextPagePattern.test(res.body) && pageCount > 0) {
      page++;
    } else {
      hasMore = false;
    }

    if (page > 200) {
      console.log('\n200ページで停止');
      break;
    }
  }

  console.log(`\n\n合計: ${allCompanyIds.size} 企業\n`);

  if (!checkDetails) {
    console.log('詳細確認するには: npx ts-node scripts/find_all_january.ts "南部・1月連絡" --details');
    return;
  }

  // Check each company
  console.log('各企業の詳細を確認中...\n');

  const companies: CompanyInfo[] = [];
  const sortedIds = Array.from(allCompanyIds).sort((a, b) => parseInt(b) - parseInt(a));
  let checked = 0;

  for (const id of sortedIds) {
    const res = await fetchWithCookies(
      `https://www.careerlink.vn:1443/executive-search/vn/companies/${id}`,
      { headers: { 'Cookie': sessionCookie } }
    );

    // Extract name
    const h1Match = res.body.match(/<h1[^>]*>([^<]+)<\/h1>/);
    let name = h1Match ? h1Match[1].trim() : 'Unknown';
    if (name.length > 40) name = name.substring(0, 37) + '...';

    // Extract tags
    const tags: string[] = [];
    const tagLinkPattern = /href="[^"]*tags\?tag=([^"]+)"/g;
    let tagMatch;
    while ((tagMatch = tagLinkPattern.exec(res.body)) !== null) {
      const decodedTag = decodeURIComponent(tagMatch[1]);
      if (decodedTag.includes('連絡') && !tags.includes(decodedTag)) {
        tags.push(decodedTag);
      }
    }

    // Also try pattern match
    const regionMonthPattern = /(南部|北部)・(\d+)月連絡/g;
    let regionMatch;
    while ((regionMatch = regionMonthPattern.exec(res.body)) !== null) {
      if (!tags.includes(regionMatch[0])) {
        tags.push(regionMatch[0]);
      }
    }

    // Extract emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const allEmails = res.body.match(emailRegex) || [];
    const emails = [...new Set(allEmails)]
      .filter(e => !e.includes('careerlink'))
      .filter(e => !e.includes('example.com'));

    companies.push({
      id,
      name,
      tags,
      hasEmail: emails.length > 0,
      emails
    });

    checked++;
    process.stdout.write(`\r確認中: ${checked}/${sortedIds.length}`);
  }

  console.log('\n\n=== 結果 ===\n');

  // Filter companies that are actually 南部・1月連絡
  const januarySouth = companies.filter(c => c.tags.includes('南部・1月連絡'));
  const januarySouthWithEmail = januarySouth.filter(c => c.hasEmail);

  console.log(`「南部・1月連絡」タグ確認済み: ${januarySouth.length}社`);
  console.log(`  うちメールあり: ${januarySouthWithEmail.length}社\n`);

  // Show companies with email
  if (januarySouthWithEmail.length > 0) {
    console.log('=== メールあり企業 ===\n');
    for (const c of januarySouthWithEmail) {
      console.log(`[${c.id}] ${c.name}`);
      console.log(`  タグ: ${c.tags.join(', ')}`);
      console.log(`  メール: ${c.emails.slice(0, 2).join(', ')}`);
      console.log('');
    }
  }

  // Show companies with wrong tags
  const wrongTags = companies.filter(c => !c.tags.includes('南部・1月連絡') && c.tags.length > 0);
  if (wrongTags.length > 0) {
    console.log(`\n=== タグ不一致（要除外）: ${wrongTags.length}社 ===\n`);
    for (const c of wrongTags.slice(0, 20)) {
      console.log(`[${c.id}] ${c.name}: ${c.tags.join(', ')}`);
    }
    if (wrongTags.length > 20) {
      console.log(`... 他 ${wrongTags.length - 20}社`);
    }
  }
}

main().catch(console.error);
