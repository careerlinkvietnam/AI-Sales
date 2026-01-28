import 'dotenv/config';
import { GmailClient } from '../src/connectors/gmail/GmailClient';

async function main() {
  const to = process.argv[2] || 'junya.takei@alsi.co.jp';
  const subject = process.argv[3] || '先日のご面談のお礼とご状況確認';
  const body = `武井様

お世話になっております。
キャリアリンクの佐藤でございます。

先日は貴重なお時間をいただき、誠にありがとうございました。
ベトナム進出のご検討状況について、詳しくお聞かせいただき大変参考になりました。

その後、市場調査のご状況はいかがでしょうか。

現時点では具体的な採用のタイミングではないかと存じますが、
今後、コアメンバーの採用をご検討される際には、
ぜひお声がけいただけましたら幸いです。

ベトナムでの採用市場や人材の動向など、
ご参考になる情報がございましたらお伝えすることも可能ですので、
お気軽にご連絡ください。

引き続きよろしくお願いいたします。

キャリアリンク
佐藤`;

  const client = new GmailClient();

  console.log('Gmail Client Mode:', client.isStubMode() ? 'Stub' : 'Real');
  console.log('');
  console.log('Creating draft...');
  console.log('  To:', to);
  console.log('  Subject:', subject);
  console.log('');

  try {
    const result = await client.createDraft(to, subject, body);
    console.log('✅ Draft created successfully!');
    console.log('  Draft ID:', result.draftId);
    console.log('  Message ID:', result.messageId);
    console.log('  Thread ID:', result.threadId);
  } catch (error) {
    console.error('❌ Failed to create draft:', error);
  }
}

main();
