import 'dotenv/config';

async function listDrafts() {
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

  // List drafts
  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=30',
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  const data = await res.json() as { drafts?: Array<{ id: string; message: { id: string } }> };

  if (!data.drafts || data.drafts.length === 0) {
    console.log('下書きなし');
    return;
  }

  console.log(`=== Gmail 下書き一覧（${data.drafts.length}件）===\n`);

  for (const draft of data.drafts) {
    // Get draft details
    const draftRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draft.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );
    const draftData = await draftRes.json() as {
      id: string;
      message?: {
        payload?: {
          headers?: Array<{ name: string; value: string }>;
        };
      };
    };

    const headers = draftData.message?.payload?.headers || [];
    const getHeader = (name: string) => {
      const header = headers.find(h => h.name === name);
      return header?.value || '(なし)';
    };

    console.log('To:', getHeader('To'));
    console.log('Subject:', getHeader('Subject'));
    console.log('Draft ID:', draft.id);
    console.log('---');
  }
}

listDrafts().catch(console.error);
