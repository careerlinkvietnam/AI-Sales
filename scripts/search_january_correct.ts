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

  // Use the exact URL format from user
  const baseSearchUrl = 'https://www.careerlink.vn:1443/executive-search/vn/companies/tags?tags=' + encodeURIComponent('南部・1月連絡');

  console.log('検索URL:', baseSearchUrl);
  console.log('');

  const companies: {id: string, name: string}[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const searchUrl = baseSearchUrl + '&page=' + page;
    const res = await fetchWithCookies(searchUrl, {
      headers: { 'Cookie': sessionCookie }
    });

    // Pattern to find company links
    const pattern = /\/companies\/(\d+)"[^>]*>([^<]+)</g;
    let match;
    let pageCount = 0;
    while ((match = pattern.exec(res.body)) !== null) {
      const id = match[1];
      const name = match[2].trim();
      if (name && name.length > 2 && !companies.find(c => c.id === id)) {
        companies.push({id, name});
        pageCount++;
      }
    }

    process.stdout.write(`\rPage ${page}: 累計 ${companies.length} 社`);

    // Check for next page
    const nextPagePattern = new RegExp(`page=${page + 1}`);
    if (nextPagePattern.test(res.body) && pageCount > 0) {
      page++;
    } else {
      hasMore = false;
    }

    if (page > 50) break;
  }

  console.log('\n');
  console.log('企業数:', companies.length);
  console.log('');
  console.log('=== 企業一覧 ===');
  companies.slice(0, 30).forEach((c, i) => {
    console.log(`${i+1}. [${c.id}] ${c.name.substring(0, 60)}`);
  });

  if (companies.length > 30) {
    console.log(`... 他 ${companies.length - 30} 社`);
  }

  // Check for specific companies
  console.log('');
  console.log('--- 特定企業検索 ---');
  const ogawa = companies.find(c => c.name.toLowerCase().includes('ogawa'));
  const link = companies.find(c => c.name.toLowerCase().includes('link station'));
  console.log('Ogawa Econos:', ogawa ? `[${ogawa.id}] ${ogawa.name}` : '見つからず');
  console.log('Link Station:', link ? `[${link.id}] ${link.name}` : '見つからず');
}

main().catch(console.error);
