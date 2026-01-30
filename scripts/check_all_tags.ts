import 'dotenv/config';
import https from 'https';
import { URL } from 'url';

const agent = new https.Agent({ rejectUnauthorized: false });

interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
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
  console.log('ログイン中...\n');

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

  const companyIds = process.argv.slice(2);

  if (companyIds.length === 0) {
    console.log('Usage: npx tsx scripts/check_all_tags.ts <companyId1> <companyId2> ...');
    console.log('Example: npx tsx scripts/check_all_tags.ts 16065 16970 17281');
    process.exit(1);
  }

  console.log('=== CRM タグ確認結果 ===\n');

  for (const id of companyIds) {
    const res = await fetchWithCookies(
      `https://www.careerlink.vn:1443/executive-search/vn/companies/${id}`,
      { headers: { 'Cookie': sessionCookie } }
    );

    // Extract company name from title or h1
    const titleMatch = res.body.match(/<title>([^<]+)<\/title>/);
    const h1Match = res.body.match(/<h1[^>]*>([^<]+)<\/h1>/);
    let name = 'Unknown';
    if (h1Match) {
      name = h1Match[1].trim();
    } else if (titleMatch) {
      name = titleMatch[1].replace(' - CareerLink', '').trim();
    }
    // Truncate long names
    if (name.length > 50) {
      name = name.substring(0, 47) + '...';
    }

    // Look for tags containing 連絡
    const foundTags: string[] = [];

    // Pattern 1: Look for tag links
    const tagLinkPattern = /href="[^"]*tags\?tag=([^"]+)"/g;
    let tagMatch;
    while ((tagMatch = tagLinkPattern.exec(res.body)) !== null) {
      const decodedTag = decodeURIComponent(tagMatch[1]);
      if (decodedTag.includes('連絡') && !foundTags.includes(decodedTag)) {
        foundTags.push(decodedTag);
      }
    }

    // Pattern 2: Look for 南部/北部 + 月連絡 in text
    const regionMonthPattern = /(南部|北部)・(\d+)月連絡/g;
    let regionMatch;
    while ((regionMatch = regionMonthPattern.exec(res.body)) !== null) {
      const tag = regionMatch[0];
      if (!foundTags.includes(tag)) {
        foundTags.push(tag);
      }
    }

    // Check for email
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = res.body.match(emailRegex) || [];
    const filteredEmails = [...new Set(emails)]
      .filter(e => !e.includes('careerlink'))
      .filter(e => !e.includes('example.com'));

    const hasEmail = filteredEmails.length > 0 ? '✅ あり' : '❌ なし';

    console.log(`[${id}] ${name}`);
    console.log(`  タグ: ${foundTags.length > 0 ? foundTags.join(', ') : '⚠️ 見つからず'}`);
    console.log(`  メール: ${hasEmail}`);
    console.log('');
  }
}

main().catch(console.error);
