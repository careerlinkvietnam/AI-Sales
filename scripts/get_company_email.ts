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
  const companyId = process.argv[2] || '18454';

  console.log('Step 1: Getting CSRF token...');
  const loginPage = await fetchWithCookies('https://www.careerlink.vn:1443/siankaan0421/login');
  const csrfMatch = loginPage.body.match(/name="authenticity_token"[^>]*value="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const setCookies = loginPage.headers['set-cookie'];
  const cookies1 = Array.isArray(setCookies)
    ? setCookies.map(c => c.split(';')[0]).join('; ')
    : '';
  console.log('  CSRF:', csrf ? 'Found' : 'Not found');

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
  console.log('  Login status:', loginRes.status);

  console.log(`Step 3: Fetching company ${companyId}...`);
  const companyRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Extract emails from HTML
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = companyRes.body.match(emailRegex) || [];
  const filteredEmails = [...new Set(emails)]
    .filter(e => !e.includes('careerlink'))
    .filter(e => !e.includes('example.com'));

  console.log('');
  console.log(`=== Company ${companyId} Emails ===`);
  if (filteredEmails.length > 0) {
    filteredEmails.forEach((e, i) => console.log(`${i+1}. ${e}`));
  } else {
    console.log('No external emails found in HTML');
    console.log('Page length:', companyRes.body.length, 'bytes');
  }
}

main().catch(console.error);
