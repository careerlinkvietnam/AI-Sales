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
  const tag = process.argv[2] || '南部・1月連絡';
  const skipId = process.argv[3]; // Optional: company ID to skip (already processed)

  console.log('Step 1: Getting CSRF token...');
  const loginPage = await fetchWithCookies('https://www.careerlink.vn:1443/siankaan0421/login');
  const csrfMatch = loginPage.body.match(/name="authenticity_token"[^>]*value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const setCookies = loginPage.headers['set-cookie'];
  const cookies1 = Array.isArray(setCookies)
    ? setCookies.map(c => c.split(';')[0]).join('; ')
    : '';

  console.log('Step 2: Logging in...');
  const loginBody = '_username=' + encodeURIComponent(process.env.CRM_LOGIN_EMAIL || '') +
    '&_password=' + encodeURIComponent(process.env.CRM_LOGIN_PASSWORD || '') +
    '&authenticity_token=' + encodeURIComponent(csrf);

  const loginRes = await fetchWithCookies('https://www.careerlink.vn:1443/siankaan0421/login_check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies1
    },
    body: loginBody
  });

  const newSetCookies = loginRes.headers['set-cookie'];
  const newCookies = Array.isArray(newSetCookies)
    ? newSetCookies.map(c => c.split(';')[0]).join('; ')
    : '';
  const sessionCookie = newCookies || cookies1;

  console.log(`Step 3: Searching companies with tag "${tag}"...`);
  const encodedTag = encodeURIComponent(tag);
  const searchRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/tags?tags=${encodedTag}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Parse HTML to extract company IDs and names
  const companyPattern = /\/companies\/(\d+)[^>]*>([^<]+)</g;
  const companies: { id: string; name: string }[] = [];
  let match;
  while ((match = companyPattern.exec(searchRes.body)) !== null) {
    const id = match[1];
    const name = match[2].trim();
    if (!companies.find(c => c.id === id)) {
      companies.push({ id, name });
    }
  }

  console.log(`Found ${companies.length} companies\n`);

  // Check each company for email
  console.log('Step 4: Checking companies for contact email...\n');

  let count = 0;
  for (const company of companies) {
    if (skipId && company.id === skipId) {
      continue; // Skip already processed
    }

    // Fetch company page to check for email
    const companyRes = await fetchWithCookies(
      `https://www.careerlink.vn:1443/executive-search/vn/companies/${company.id}`,
      { headers: { 'Cookie': sessionCookie } }
    );

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = companyRes.body.match(emailRegex) || [];
    const filteredEmails = [...new Set(emails)]
      .map(e => e.replace(/^u003e/i, ''))
      .filter(e => !e.includes('careerlink'))
      .filter(e => !e.includes('example.com'))
      // 代表メールは担当者連絡先とみなさない
      .filter(e => !e.startsWith('info@'))
      .filter(e => !e.startsWith('hr@'))
      .filter(e => !e.startsWith('contact@'))
      .filter(e => !e.startsWith('admin@'))
      .filter(e => !e.startsWith('sales@'))
      .filter(e => !e.startsWith('support@'))
      .filter(e => !e.startsWith('recruit@'));

    const hasEmail = filteredEmails.length > 0;

    count++;
    if (hasEmail) {
      console.log(`✅ [${company.id}] ${company.name}`);
      console.log(`   Email: ${filteredEmails[0]}`);
      console.log(`   CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/${company.id}`);
      console.log('');
      console.log('=== 次の処理候補 ===');
      console.log(`企業ID: ${company.id}`);
      console.log(`企業名: ${company.name}`);
      console.log(`メール: ${filteredEmails[0]}`);
      break; // Found one with email
    } else {
      console.log(`❌ [${company.id}] ${company.name} - メールなし（スキップ）`);
    }

    // Limit to checking first 20 companies
    if (count >= 20) {
      console.log('\n... (20社確認、メールあり企業なし)');
      break;
    }
  }
}

main().catch(console.error);
