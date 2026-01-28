import 'dotenv/config';

async function listSentEmails() {
  const clientId = process.env.GMAIL_CLIENT_ID!;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET!;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN!;

  // Get access token
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
  if (!tokenRes.ok) {
    console.log('Token error:', tokenData);
    return;
  }

  const accessToken = tokenData.access_token;

  // Search sent emails (last 20)
  const query = encodeURIComponent('in:sent');
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  const data = await res.json() as { messages?: Array<{ id: string }> };

  if (!data.messages || data.messages.length === 0) {
    console.log('送信済みメールなし');
    return;
  }

  console.log(`=== sato@careerlink.vn 送信済みメール（直近${data.messages.length}件）===\n`);

  for (const msg of data.messages) {
    // Get message details
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );
    const msgData = await msgRes.json() as {
      payload?: {
        headers?: Array<{ name: string; value: string }>;
      };
    };

    const headers = msgData.payload?.headers || [];
    const getHeader = (name: string) => {
      const header = headers.find(h => h.name === name);
      return header?.value || 'N/A';
    };

    console.log('To:', getHeader('To'));
    console.log('Subject:', getHeader('Subject'));
    console.log('Date:', getHeader('Date'));
    console.log('---');
  }
}

listSentEmails().catch(console.error);
