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
  const companyId = process.argv[2];
  if (!companyId) {
    console.log('Usage: npx ts-node scripts/check_company.ts <companyId>');
    process.exit(1);
  }

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

  // Get company page
  const res = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Extract name
  const h1Match = res.body.match(/<h1[^>]*>([^<]+)<\/h1>/);
  let name = h1Match ? h1Match[1].trim() : 'Unknown';

  // Extract tags from tag links
  const tags: string[] = [];
  const tagLinkPattern = /href="[^"]*tags\?tags=([^"]+)"/g;
  let tagMatch;
  while ((tagMatch = tagLinkPattern.exec(res.body)) !== null) {
    const decodedTag = decodeURIComponent(tagMatch[1]);
    if (!tags.includes(decodedTag)) {
      tags.push(decodedTag);
    }
  }

  // Extract emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const allEmails = res.body.match(emailRegex) || [];
  const emails = [...new Set(allEmails)]
    .filter(e => !e.includes('careerlink'))
    .filter(e => !e.includes('example.com'));

  // Extract company website URL
  const urlPattern = /href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g;
  const urls: string[] = [];
  let urlMatch;
  while ((urlMatch = urlPattern.exec(res.body)) !== null) {
    const url = urlMatch[1];
    if (!url.includes('careerlink') &&
        !url.includes('google') &&
        !url.includes('facebook') &&
        !url.includes('linkedin') &&
        !url.includes('maps.')) {
      urls.push(url);
    }
  }

  console.log('========================================');
  console.log(`企業ID: ${companyId}`);
  console.log(`企業名: ${name}`);
  console.log(`タグ: ${tags.length > 0 ? tags.join(', ') : '⚠️ なし'}`);
  console.log(`メール: ${emails.length > 0 ? emails.join(', ') : 'なし'}`);
  console.log(`企業サイト: ${urls.length > 0 ? urls[0] : 'なし'}`);
  console.log(`CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`);
  console.log('========================================');

  // Check if it has 南部・1月連絡 tag
  const hasJanuaryTag = tags.some(t => t.includes('南部') && t.includes('1月'));
  if (hasJanuaryTag) {
    console.log('✅ 南部・1月連絡タグあり → 処理対象');
  } else if (tags.length > 0) {
    console.log('❌ 南部・1月連絡タグなし → スキップ');
  } else {
    console.log('⚠️ タグ取得できず → CRMで手動確認必要');
  }
}

main().catch(console.error);
