import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';

dotenv.config();

async function testTwitterAPI() {
  console.log('🔑 Testing Twitter API credentials...\n');
  
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET_KEY!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
  });

  try {
    // Test 1: Get authenticated user info
    console.log('📝 Test 1: Getting authenticated user info...');
    const me = await client.v2.me();
    console.log('✅ SUCCESS! User info:', {
      id: me.data.id,
      username: me.data.username,
      name: me.data.name,
    });
    console.log('\n');

    // Test 2: Try to get mentions
    console.log('📝 Test 2: Getting mentions...');
    const mentions = await client.v2.userMentionTimeline(me.data.id, {
      max_results: 5,
      'tweet.fields': ['author_id', 'created_at'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });
    
    console.log('✅ SUCCESS! Mentions response:', {
      meta: mentions.meta,
      resultCount: mentions.meta?.result_count || 0,
    });
    
    if (mentions.data && mentions.data.length > 0) {
      console.log('First mention:', mentions.data[0]);
    }
    
  } catch (error: any) {
    console.error('\n❌ ERROR DETAILS:\n');
    console.error('Message:', error.message);
    console.error('Code:', error.code);
    console.error('Status:', error.statusCode);
    console.error('\nFull error data:', JSON.stringify(error.data, null, 2));
    console.error('\nFull error object:', JSON.stringify(error, null, 2));
    console.error('\nError keys:', Object.keys(error));
    
    // Check if it's a rate limit error
    if (error.rateLimit) {
      console.error('\nRate limit info:', error.rateLimit);
    }
  }
}

testTwitterAPI();
