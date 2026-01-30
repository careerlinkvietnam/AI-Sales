import 'dotenv/config';

async function searchSentEmails(searchQuery: string) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('Gmail credentials not configured');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokenData = await tokenRes.json() as { access_token: string };
  const accessToken = tokenData.access_token;

  // Search for sent emails
  const query = encodeURIComponent(`in:sent ${searchQuery}`);
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=10`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const data = await res.json() as { messages?: Array<{ id: string }> };

  if (!data.messages || data.messages.length === 0) {
    console.log(`"${searchQuery}" 宛ての送信履歴なし`);
    return;
  }

  console.log(`=== "${searchQuery}" 送信履歴（${data.messages.length}件）===\n`);

  for (const msg of data.messages) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const msgData = await msgRes.json() as {
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    };

    const headers = msgData.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || 'N/A';

    console.log('To:', getHeader('To'));
    console.log('Subject:', getHeader('Subject'));
    console.log('Date:', getHeader('Date'));
    console.log('---');
  }
}

const query = process.argv[2] || 'oneasia.legal';
searchSentEmails(query).catch(console.error);
