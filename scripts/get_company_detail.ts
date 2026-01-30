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
    console.log('Usage: npx tsx scripts/get_company_detail.ts <companyId>');
    console.log('Example: npx tsx scripts/get_company_detail.ts 16065');
    process.exit(1);
  }

  console.log('Logging in...');
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

  // Fetch company JSON
  console.log(`Fetching company ${companyId} (JSON)...`);
  const jsonRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}.json`,
    {
      headers: {
        'Cookie': sessionCookie,
        'Accept': 'application/json'
      }
    }
  );

  // Fetch company HTML for additional info
  console.log(`Fetching company ${companyId} (HTML)...`);
  const htmlRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Parse JSON
  let companyData: any = {};
  try {
    companyData = JSON.parse(jsonRes.body);
  } catch (e) {
    console.log('JSON parse error, using HTML only');
  }

  // Extract company name from HTML
  const nameMatch = htmlRes.body.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const companyName = nameMatch ? nameMatch[1].trim() : companyData.name || 'Unknown';

  // Extract URL from HTML
  const urlMatch = htmlRes.body.match(/href="(https?:\/\/[^"]+)"[^>]*target="_blank"/);
  const companyUrl = urlMatch ? urlMatch[1] : companyData.url || '';

  // Extract emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = htmlRes.body.match(emailRegex) || [];
  const filteredEmails = [...new Set(emails)]
    .map(e => e.replace(/^u003e/i, ''))
    .filter(e => !e.includes('careerlink'))
    .filter(e => !e.includes('example.com'));

  // Extract staff names from HTML
  const staffPattern = /<td[^>]*>([^<]*(?:Mr\.|Ms\.|Mrs\.)[^<]*)<\/td>/gi;
  const staffs: string[] = [];
  let staffMatch;
  while ((staffMatch = staffPattern.exec(htmlRes.body)) !== null) {
    staffs.push(staffMatch[1].trim());
  }

  // Extract recent activity/notes
  const notesPattern = /class="note[^"]*"[^>]*>([^<]+)</gi;
  const notes: string[] = [];
  let noteMatch;
  while ((noteMatch = notesPattern.exec(htmlRes.body)) !== null) {
    const note = noteMatch[1].trim();
    if (note.length > 10) notes.push(note);
  }

  console.log('\n========================================');
  console.log('企業詳細');
  console.log('========================================');
  console.log(`企業ID: ${companyId}`);
  console.log(`企業名: ${companyName}`);
  console.log(`URL: ${companyUrl}`);
  console.log(`CRM: https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`);
  console.log(`メール: ${filteredEmails.join(', ') || 'なし'}`);

  if (companyData.region) {
    console.log(`地域: ${companyData.region}`);
  }
  if (companyData.industry) {
    console.log(`業種: ${companyData.industry}`);
  }

  if (staffs.length > 0) {
    console.log(`担当者: ${staffs.join(', ')}`);
  }

  console.log('\n--- JSON Data ---');
  console.log(JSON.stringify(companyData, null, 2).substring(0, 2000));
}

main().catch(console.error);
