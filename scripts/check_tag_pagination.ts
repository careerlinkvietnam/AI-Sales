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

  const tag = process.argv[2] || '南部・1月連絡';
  console.log(`タグ検索: ${tag}\n`);

  const encodedTag = encodeURIComponent(tag);
  const searchRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/tags?tags=${encodedTag}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  console.log(`Status: ${searchRes.status}`);
  console.log(`Body length: ${searchRes.body.length} bytes`);

  // Count company links
  const companyPattern = /\/companies\/(\d+)/g;
  const ids = new Set<string>();
  let match;
  while ((match = companyPattern.exec(searchRes.body)) !== null) {
    ids.add(match[1]);
  }
  console.log(`企業ID数（このページ）: ${ids.size}`);

  // Check for total count in the page
  const totalMatch = searchRes.body.match(/(\d+)\s*件/);
  if (totalMatch) {
    console.log(`件数表示: ${totalMatch[0]}`);
  }

  // Check for pagination links
  const pageLinks = searchRes.body.match(/page=(\d+)/g);
  if (pageLinks) {
    const uniquePages = [...new Set(pageLinks)];
    console.log(`ページネーション: ${uniquePages.join(', ')}`);

    // Find max page
    const pageNums = uniquePages.map(p => parseInt(p.replace('page=', '')));
    const maxPage = Math.max(...pageNums);
    console.log(`最大ページ: ${maxPage}`);
  } else {
    console.log('ページネーション: なし');
  }

  // Show IDs found
  console.log('\n--- このページの企業ID ---');
  const sortedIds = Array.from(ids).sort((a, b) => parseInt(b) - parseInt(a));
  console.log(sortedIds.join(', '));
}

main().catch(console.error);
