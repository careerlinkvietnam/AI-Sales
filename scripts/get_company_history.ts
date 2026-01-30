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
    console.log('Usage: npx tsx scripts/get_company_history.ts <companyId>');
    console.log('Example: npx tsx scripts/get_company_history.ts 16065');
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

  // Fetch company HTML page (contains history/notes)
  console.log(`Fetching company ${companyId} page...`);
  const htmlRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`,
    { headers: { 'Cookie': sessionCookie } }
  );

  // Try to fetch timeline API
  console.log(`Fetching timeline for company ${companyId}...`);
  const timelineRes = await fetchWithCookies(
    `https://www.careerlink.vn:1443/executive-search/vn/timeline/companies/${companyId}`,
    {
      headers: {
        'Cookie': sessionCookie,
        'Accept': 'application/json'
      }
    }
  );

  console.log('\n========================================');
  console.log(`企業 ${companyId} の連絡履歴`);
  console.log('========================================\n');

  // Try parsing timeline JSON
  if (timelineRes.status === 200) {
    try {
      const timeline = JSON.parse(timelineRes.body);
      if (Array.isArray(timeline) && timeline.length > 0) {
        console.log('--- Timeline API ---');
        timeline.slice(0, 10).forEach((item: any, i: number) => {
          console.log(`\n[${i + 1}] ${item.date || item.createdAt || 'N/A'}`);
          console.log(`    Type: ${item.type || 'N/A'}`);
          console.log(`    User: ${item.user || item.userName || 'N/A'}`);
          if (item.content || item.note || item.memo) {
            console.log(`    内容: ${(item.content || item.note || item.memo).substring(0, 200)}`);
          }
        });
      } else {
        console.log('Timeline API: データなし');
      }
    } catch (e) {
      console.log('Timeline API: パース失敗');
    }
  } else {
    console.log(`Timeline API: HTTP ${timelineRes.status}`);
  }

  // Extract notes/activities from HTML
  console.log('\n--- HTML から抽出 ---\n');

  // Look for activity/history sections
  const activityPattern = /<div[^>]*class="[^"]*(?:activity|history|timeline|note|memo)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const activities: string[] = [];
  let actMatch;
  while ((actMatch = activityPattern.exec(htmlRes.body)) !== null) {
    const text = actMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 20 && text.length < 500) {
      activities.push(text);
    }
  }

  // Look for date entries
  const datePattern = /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})[^<]*<[^>]*>([^<]+)/g;
  let dateMatch;
  while ((dateMatch = datePattern.exec(htmlRes.body)) !== null) {
    const date = dateMatch[1];
    const text = dateMatch[2].trim();
    if (text.length > 5) {
      activities.push(`${date}: ${text}`);
    }
  }

  // Look for sales_action or contact records
  const salesPattern = /sales_action[^>]*>([^<]+)/gi;
  while ((actMatch = salesPattern.exec(htmlRes.body)) !== null) {
    activities.push(actMatch[1].trim());
  }

  // Extract any visible text blocks that look like notes
  const textBlockPattern = /<(?:p|div|td|span)[^>]*>([^<]{50,500})<\/(?:p|div|td|span)>/gi;
  while ((actMatch = textBlockPattern.exec(htmlRes.body)) !== null) {
    const text = actMatch[1].trim();
    // Filter to likely note content
    if (text.match(/連絡|訪問|電話|メール|打合|面談|採用|候補|ニーズ|検討/)) {
      activities.push(text);
    }
  }

  if (activities.length > 0) {
    [...new Set(activities)].slice(0, 15).forEach((act, i) => {
      console.log(`[${i + 1}] ${act}`);
      console.log('');
    });
  } else {
    console.log('履歴データが見つかりませんでした。');
    console.log('\nCRMページを直接確認してください:');
    console.log(`https://www.careerlink.vn:1443/executive-search/vn/companies/${companyId}`);
  }

  // Show raw HTML sections for debugging
  console.log('\n--- ページ構造 (デバッグ用) ---');
  console.log(`HTML サイズ: ${htmlRes.body.length} bytes`);

  // Find section headers
  const sectionPattern = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi;
  const sections: string[] = [];
  let secMatch;
  while ((secMatch = sectionPattern.exec(htmlRes.body)) !== null) {
    sections.push(secMatch[1].trim());
  }
  if (sections.length > 0) {
    console.log('セクション:', sections.join(', '));
  }
}

main().catch(console.error);
