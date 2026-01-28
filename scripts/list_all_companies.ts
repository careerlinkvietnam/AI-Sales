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

  // Search companies by tag
  console.log(`タグ "${tag}" で検索中...\n`);
  const encodedTag = encodeURIComponent(tag);
  const searchRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/tags?tags=${encodedTag}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Parse HTML - look for company links
  const companyPattern = /<a[^>]*href="\/executive-search\/vn\/companies\/(\d+)"[^>]*>([^<]*)<\/a>/g;
  const companies: { id: string; name: string }[] = [];
  let match;
  while ((match = companyPattern.exec(searchRes.body)) !== null) {
    const id = match[1];
    const name = match[2].trim();
    if (name && !companies.find(c => c.id === id)) {
      companies.push({ id, name });
    }
  }

  console.log(`=== ${tag} タグの企業一覧 ===`);
  console.log(`合計: ${companies.length}社\n`);

  for (const company of companies) {
    // Get company detail
    const companyRes = await fetchWithCookies(
      `https://www.careerlink.vn:1443/executive-search/vn/companies/${company.id}`,
      { headers: { 'Cookie': sessionCookie } }
    );

    // Find all tags on the page
    const tagPattern = /南部・(\d+)月連絡/g;
    const pageTags: string[] = [];
    let tagMatch;
    while ((tagMatch = tagPattern.exec(companyRes.body)) !== null) {
      pageTags.push(tagMatch[1] + '月');
    }
    const uniqueTags = [...new Set(pageTags)];

    // Find emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = companyRes.body.match(emailRegex) || [];
    const filteredEmails = [...new Set(emails)]
      .filter(e => !e.includes('careerlink'))
      .filter(e => !e.includes('example.com'));

    const contactEmail = filteredEmails.find(e =>
      !e.startsWith('info@') &&
      !e.startsWith('hr@') &&
      !e.startsWith('contact@') &&
      !e.startsWith('admin@') &&
      !e.startsWith('sales@') &&
      !e.startsWith('support@') &&
      !e.startsWith('recruit@')
    );

    const displayEmail = contactEmail || filteredEmails[0] || 'なし';

    console.log(`[${company.id}] ${company.name || '(名前なし)'}`);
    console.log(`  タグ: ${uniqueTags.length > 0 ? uniqueTags.join(', ') : '確認不可'}`);
    console.log(`  メール: ${displayEmail}`);
    console.log('');
  }
}

main().catch(console.error);
