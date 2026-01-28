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
    console.log('Usage: npx ts-node scripts/get_company_full.ts <companyId>');
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

  // Also get JSON
  const jsonRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}.json`,
    { headers: { 'Cookie': sessionCookie, 'Accept': 'application/json' } }
  );

  let jsonData: any = {};
  try {
    jsonData = JSON.parse(jsonRes.body);
  } catch (e) {
    // ignore
  }

  // Extract name
  const h1Match = res.body.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const name = h1Match ? h1Match[1].trim() : jsonData.name_en || 'Unknown';

  // Extract all URLs from the page
  const urlPattern = /href="(https?:\/\/[^"]+)"/g;
  const allUrls: string[] = [];
  let urlMatch;
  while ((urlMatch = urlPattern.exec(res.body)) !== null) {
    const url = urlMatch[1];
    // Filter out common non-company URLs
    if (!url.includes('careerlink') &&
        !url.includes('google') &&
        !url.includes('facebook') &&
        !url.includes('linkedin') &&
        !url.includes('twitter') &&
        !url.includes('youtube') &&
        !url.includes('maps.') &&
        !url.includes('instagram')) {
      if (!allUrls.includes(url)) {
        allUrls.push(url);
      }
    }
  }

  // Extract emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const allEmails = res.body.match(emailRegex) || [];
  const emails = [...new Set(allEmails)]
    .filter(e => !e.includes('careerlink'))
    .filter(e => !e.includes('example.com'));

  // Extract tags
  const tags: string[] = [];
  const tagLinkPattern = /href="[^"]*tags\?tags=([^"]+)"/g;
  let tagMatch;
  while ((tagMatch = tagLinkPattern.exec(res.body)) !== null) {
    const decodedTag = decodeURIComponent(tagMatch[1]);
    if (!tags.includes(decodedTag)) {
      tags.push(decodedTag);
    }
  }

  // Extract from tagit-label spans
  const tagLabelPattern = /<span class="tagit-label">([^<]+)<\/span>/g;
  while ((tagMatch = tagLabelPattern.exec(res.body)) !== null) {
    if (!tags.includes(tagMatch[1])) {
      tags.push(tagMatch[1]);
    }
  }

  // Get offices and staffs from JSON
  const offices = jsonData.offices || [];

  console.log('========================================');
  console.log(`企業ID: ${companyId}`);
  console.log(`企業名: ${name}`);
  console.log(`タグ: ${tags.length > 0 ? tags.join(', ') : 'なし'}`);
  console.log(`メール: ${emails.length > 0 ? emails.join(', ') : 'なし'}`);
  console.log(`企業サイト: ${allUrls.length > 0 ? allUrls.join(', ') : 'なし'}`);
  console.log(`CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`);
  console.log('');

  if (offices.length > 0) {
    console.log('--- オフィス・担当者 ---');
    for (const office of offices) {
      console.log(`${office.name}:`);
      if (office.staffs && office.staffs.length > 0) {
        for (const staff of office.staffs) {
          console.log(`  - ${staff.name}`);
        }
      } else {
        console.log('  (担当者なし)');
      }
    }
  }

  console.log('========================================');
}

main().catch(console.error);
