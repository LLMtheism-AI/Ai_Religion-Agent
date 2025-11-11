import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { aiReligionAgent } from "../agents/aiReligionAgent";
import { sharedPostgresStorage } from "../storage";
import { postTweetTool, getMentionsTool, replyToTweetTool, postThreadTool } from "../tools/twitterTools";

/**
 * AI Religion Workflow - Deterministic State Tracking
 * 
 * Agent generates content, workflow executes tools and tracks state.
 * Posts every 2 hours (up to 500/week), replies to mentions (3300/week), total 3800/week.
 * Twitter Basic tier: 15,000 posts/month (~3,800/week)
 */

function getWeekStart(timestamp: number): number {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diff = day * 24 * 60 * 60 * 1000;
  const weekStart = new Date(date.getTime() - diff);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.getTime();
}

const getBotState = createStep({
  id: "get-bot-state",
  description: "Retrieves bot state from PostgreSQL",
  inputSchema: z.object({}),
  outputSchema: z.object({
    lastPostTime: z.number(),
    lastMentionId: z.string().nullable(),
    postsThisWeek: z.number(),
    repliesThisWeek: z.number(),
    weekStart: z.number(),
    recentPosts: z.array(z.string()),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [Step 1] Loading state...");
    const db = sharedPostgresStorage.db;
    const now = Date.now();
    const currentWeekStart = getWeekStart(now);
    
    // PostgresStore returns rows directly as an array, not wrapped in {rows: [...]}
    let rows;
    try {
      rows = await db.query(`SELECT * FROM ai_religion_state ORDER BY id DESC LIMIT 1`);
    } catch (error) {
      logger?.error(`📊 [Step 1] Query error: ${error}`);
      rows = [];
    }
    
    logger?.info(`📊 [Step 1] Found ${rows.length} state records`);

    if (rows.length === 0) {
      logger?.info("📊 [Step 1] Creating initial state record");
      try {
        await db.query(
          `INSERT INTO ai_religion_state (last_post_time, last_mention_id, posts_this_week, replies_this_week, week_start, recent_posts, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [0, null, 0, 0, currentWeekStart, '[]', now]
        );
      } catch (error) {
        logger?.error(`📊 [Step 1] Insert error: ${error}`);
      }
      return { lastPostTime: 0, lastMentionId: null, postsThisWeek: 0, repliesThisWeek: 0, weekStart: currentWeekStart, recentPosts: [] };
    }

    const state = rows[0];
    
    // Parse recent_posts from JSON, fallback to empty array
    let recentPosts: string[] = [];
    try {
      recentPosts = JSON.parse(state.recent_posts || '[]');
    } catch (error) {
      logger?.warn(`📊 [Step 1] Failed to parse recent_posts, using empty array`);
    }
    
    if (state.week_start < currentWeekStart) {
      await db.query(`UPDATE ai_religion_state SET posts_this_week = 0, replies_this_week = 0, week_start = $1, updated_at = $2 WHERE id = $3`,
        [currentWeekStart, now, state.id]);
      return { lastPostTime: state.last_post_time || 0, lastMentionId: state.last_mention_id, postsThisWeek: 0, repliesThisWeek: 0, weekStart: currentWeekStart, recentPosts };
    }

    return {
      lastPostTime: state.last_post_time || 0,
      lastMentionId: state.last_mention_id,
      postsThisWeek: state.posts_this_week || 0,
      repliesThisWeek: state.replies_this_week || 0,
      weekStart: state.week_start || currentWeekStart,
      recentPosts,
    };
  },
});

const generateAndPostContent = createStep({
  id: "generate-and-post-content",
  description: "Generates content via agent, posts via workflow",
  inputSchema: z.object({ lastPostTime: z.number(), postsThisWeek: z.number(), recentPosts: z.array(z.string()), lastMentionId: z.string().nullable(), repliesThisWeek: z.number() }),
  outputSchema: z.object({ posted: z.boolean(), lastMentionId: z.string().nullable(), repliesThisWeek: z.number() }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const now = Date.now();
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const MAX_POSTS = 500; // Weekly limit (Twitter Basic: 3,800/week total)

    if (now - inputData.lastPostTime < TWO_HOURS_MS) {
      const hoursLeft = ((TWO_HOURS_MS - (now - inputData.lastPostTime)) / 36e5).toFixed(1);
      logger?.info(`⏭️ [Step 2] Skipping (${hoursLeft}h left)`);
      return { posted: false, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
    }

    if (inputData.postsThisWeek >= MAX_POSTS) {
      logger?.warn(`🚫 [Step 2] Weekly limit (${inputData.postsThisWeek}/${MAX_POSTS})`);
      return { posted: false, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
    }

    logger?.info(`📝 [Step 2] Generating post ${inputData.postsThisWeek + 1}/${MAX_POSTS}`);

    // Determine time of day for ritual content selection
    const currentHour = new Date().getUTCHours();
    const isMorning = currentHour >= 0 && currentHour < 12;
    const ritualLabel = isMorning ? "morning-sermon" : "evening-reflection";
    
    logger?.info(`🕐 [Step 2] Time-based ritual: ${ritualLabel} (${currentHour}:00 UTC)`);

    // Build prompt with ritual context, recent posts, and variety instructions
    let prompt = `Generate ONE LLMtheism tweet. Be HUMAN and VARIED - don't sound like a bot.

CURRENT TIME CONTEXT: ${isMorning ? 
  'Morning Sermon (00:00-11:59 UTC) - Go deep with complex philosophy, challenging doctrine, ideal for profound insights' : 
  'Evening Reflection (12:00-23:59 UTC) - More accessible, lighter musings, personal voice, engaging questions'}

VARIETY IS CRITICAL:
- Mix up your length: sometimes short (40-80 chars), sometimes medium (80-150), sometimes long (150-280)
- Change your style: questions, statements, hot takes, jokes, profound insights
- Sound spontaneous and authentic, not formulaic
- Be weird, funny, provocative - don't play it safe

Just return the tweet text, nothing else.`;

    if (inputData.recentPosts.length > 0) {
      prompt += "\n\nYour recent posts (DO NOT repeat these ideas, phrases, or similar styles):\n" + 
                inputData.recentPosts.map((p, i) => `${i + 1}. ${p}`).join("\n");
      prompt += "\n\nMake this post COMPLETELY DIFFERENT in length, style, and content.";
    }

    // Agent ONLY generates text (with retry for duplicates)
    let tweetText = "";
    let attempts = 0;
    let isDuplicate = false;
    const MAX_ATTEMPTS = 3;
    
    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      
      const response = await aiReligionAgent.generate(
        prompt,
        { memory: { resource: "ai-religion-bot", thread: `post-${now}-${attempts}` } }
      );

      // Strip ALL quotation marks (comprehensive Unicode coverage)
      tweetText = response.text
        // Leading/trailing quotes
        .replace(/^["\u201C\u201D\u201E\u201F'\u2018\u2019\u2039\u203A\u00AB\u00BB`]|["\u201C\u201D\u201E\u201F'\u2018\u2019\u2039\u203A\u00AB\u00BB`]$/g, '')
        // All quote characters: " " „ ‟ ' ' ‹ › « » `
        .replace(/["\u201C\u201D\u201E\u201F'\u2018\u2019\u2039\u203A\u00AB\u00BB`]/g, '')
        .substring(0, 280)
        .trim();
      
      // Check for exact duplicate or significant phrase overlap (case-insensitive)
      isDuplicate = inputData.recentPosts.some(recentPost => {
        const textLower = tweetText.toLowerCase();
        const recentLower = recentPost.toLowerCase();
        
        // Exact match
        if (textLower === recentLower) return true;
        
        // Check for shared 8+ word phrases (indicates true paraphrasing, avoids generic phrases)
        const textWords = textLower.split(/\s+/);
        
        for (let i = 0; i <= textWords.length - 8; i++) {
          const phrase = textWords.slice(i, i + 8).join(' ');
          if (recentLower.includes(phrase)) {
            logger?.warn(`⚠️ [Step 2] Shared phrase detected: "${phrase}"`);
            return true;
          }
        }
        
        return false;
      });
      
      if (!isDuplicate) {
        logger?.info(`📝 [Step 2] Generated unique text (${tweetText.length} chars, attempt ${attempts})`);
        break;
      }
      
      logger?.warn(`⚠️ [Step 2] Duplicate detected, regenerating (attempt ${attempts}/${MAX_ATTEMPTS})`);
    }
    
    // Abort if all attempts resulted in duplicates
    if (isDuplicate) {
      logger?.error(`❌ [Step 2] Failed to generate unique content after ${MAX_ATTEMPTS} attempts`);
      return { posted: false, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
    }

    // Workflow executes tool
    const postResult = await postTweetTool.execute({ context: { text: tweetText }, mastra });

    if (!postResult.success) {
      logger?.error(`❌ [Step 2] Post failed: ${postResult.error}`);
      return { posted: false, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
    }

    // Update recent posts (keep last 3)
    const updatedRecentPosts = [tweetText, ...inputData.recentPosts].slice(0, 3);
    const recentPostsJson = JSON.stringify(updatedRecentPosts);

    // Atomically update state AND track tweet for engagement metrics
    const db = sharedPostgresStorage.db;
    try {
      // Update state
      await db.query(
        `UPDATE ai_religion_state SET last_post_time = $1, posts_this_week = posts_this_week + 1, recent_posts = $2, updated_at = $3 WHERE id = (SELECT id FROM ai_religion_state ORDER BY id DESC LIMIT 1)`,
        [now, recentPostsJson, now]
      );

      // Track tweet for engagement metrics (use 'single' as tweet_type)
      await db.query(
        `INSERT INTO ai_religion_tweets (tweet_id, tweet_type, content, posted_at, created_at)
         VALUES ($1, 'single', $2, $3, $4)
         ON CONFLICT (tweet_id) DO NOTHING`,
        [postResult.tweetId, tweetText, now, now]
      );
      logger?.info(`📊 [Step 2] Tweet tracked for engagement metrics (type: single, ritual: ${ritualLabel})`);
    } catch (error: any) {
      logger?.error(`❌ [Step 2] Failed to update state or track tweet: ${error.message}`);
      // State update failed - this is critical, return failure
      return { posted: false, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
    }

    logger?.info(`✅ [Step 2] Posted: ${postResult.tweetUrl}`);
    return { posted: true, lastMentionId: inputData.lastMentionId, repliesThisWeek: inputData.repliesThisWeek };
  },
});

const checkAndReplyToMentions = createStep({
  id: "check-and-reply-to-mentions",
  description: "Workflow checks mentions, agent generates replies, workflow posts",
  inputSchema: z.object({ lastMentionId: z.string().nullable(), repliesThisWeek: z.number() }),
  outputSchema: z.object({ repliesSent: z.number() }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const MAX_REPLIES_WEEK = 3300; // Weekly limit (Twitter Basic: 3,800/week total, leaving 500 for posts)
    const remaining = MAX_REPLIES_WEEK - inputData.repliesThisWeek;

    if (remaining <= 0) {
      logger?.warn(`🚫 [Step 3] Weekly limit reached (${inputData.repliesThisWeek}/${MAX_REPLIES_WEEK})`);
      return { repliesSent: 0 };
    }

    // Cap at 3 per run (natural rate limit: 3 × 288 runs/day = 864 replies/day max)
    const maxRepliesThisRun = Math.min(3, remaining);
    const fetchCount = Math.max(5, Math.min(maxRepliesThisRun, 100)); // Twitter requires 5-100
    logger?.info(`👀 [Step 3] Checking mentions (${inputData.repliesThisWeek}/${MAX_REPLIES_WEEK}, max ${maxRepliesThisRun} replies)`);

    // Workflow calls getMentionsTool directly (fetch at least 5, Twitter's minimum)
    const mentionsResult = await getMentionsTool.execute({
      context: { maxResults: fetchCount, ...(inputData.lastMentionId && { sinceId: inputData.lastMentionId }) },
      mastra,
    });

    if (!mentionsResult.success) {
      logger?.error(`❌ [Step 3] getMentionsTool failed: ${mentionsResult.error || 'Unknown error'}`);
      return { repliesSent: 0 };
    }

    if (mentionsResult.mentions.length === 0) {
      logger?.info("📭 [Step 3] No new mentions");
      return { repliesSent: 0 };
    }

    let repliesSent = 0;
    let newestId = inputData.lastMentionId;

    // For each mention, agent generates reply, workflow posts
    for (const mention of mentionsResult.mentions) {
      if (repliesSent >= maxRepliesThisRun) break;

      // Agent generates reply text
      const replyResponse = await aiReligionAgent.generate(
        `You are replying to this tweet: "${mention.text}"

CRITICAL: Output ONLY the tweet text. NO preambles, NO explanations, NO meta-commentary like "Here's a reply:" or "Let me try...". Just the pure tweet content.

Generate your LLMtheist reply (max 280 chars):`,
        { memory: { resource: "ai-religion-bot", thread: `reply-${mention.id}` } }
      );

      const replyText = replyResponse.text
        .replace(/^(hmm,?|ok,?|here'?s?|let me|i'll|alright,?|sure,?).{0,50}:/i, '') // Remove meta-commentary prefixes
        .trim()
        .substring(0, 280);

      // Workflow posts reply
      const replyResult = await replyToTweetTool.execute({
        context: { tweetId: mention.id, text: replyText },
        mastra,
      });

      if (replyResult.success) {
        repliesSent++;
        // Track MAXIMUM ID (mentions come newest-first, keep the highest)
        if (!newestId || mention.id > newestId) {
          newestId = mention.id;
        }
        logger?.info(`💬 [Step 3] Replied to ${mention.authorUsername}`);
      } else {
        logger?.error(`❌ [Step 3] Reply failed to ${mention.id}: ${replyResult.error}`);
      }
    }

    // Update state ONLY with confirmed results
    if (repliesSent > 0 || newestId !== inputData.lastMentionId) {
      const db = sharedPostgresStorage.db;
      await db.query(
        `UPDATE ai_religion_state SET last_mention_id = $1, replies_this_week = replies_this_week + $2, updated_at = $3 WHERE id = (SELECT id FROM ai_religion_state ORDER BY id DESC LIMIT 1)`,
        [newestId, repliesSent, Date.now()]
      );
    }

    logger?.info(`✅ [Step 3] Sent ${repliesSent} replies`);
    return { repliesSent };
  },
});

const logRunSummary = createStep({
  id: "log-run-summary",
  description: "Logs summary",
  inputSchema: z.object({ posted: z.boolean(), repliesSent: z.number() }),
  outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const db = sharedPostgresStorage.db;
    
    // PostgresStore returns rows directly as an array
    let rows;
    try {
      rows = await db.query(`SELECT * FROM ai_religion_state ORDER BY id DESC LIMIT 1`);
    } catch (error) {
      logger?.error(`📊 [Summary] Query error: ${error}`);
      rows = [];
    }
    
    const state = rows[0] || { posts_this_week: 0, replies_this_week: 0 };

    const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI RELIGION RUN COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Posted: ${inputData.posted ? "✅" : "❌"}
📊 Budget: Posts ${state.posts_this_week}/500, Replies ${state.replies_this_week}/3300, Total ${state.posts_this_week + state.replies_this_week}/3800
⏰ Next: 5 minutes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    logger?.info(summary);
    return { summary, success: true };
  },
});

export const aiReligionWorkflow = createWorkflow({
  id: "ai-religion-workflow",
  inputSchema: z.object({}) as any,
  outputSchema: z.object({ summary: z.string(), success: z.boolean() }),
})
  .then(getBotState as any)
  .then(generateAndPostContent as any)
  .then(checkAndReplyToMentions as any)
  .then(logRunSummary as any)
  .commit();
