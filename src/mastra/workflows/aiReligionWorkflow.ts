import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { aiReligionAgent } from "../agents/aiReligionAgent";
import { sharedPostgresStorage } from "../storage";
import { postTweetTool, getMentionsTool, replyToTweetTool } from "../tools/twitterTools";

/**
 * AI Religion Workflow - Deterministic State Tracking
 * 
 * Agent generates content, workflow executes tools and tracks state.
 * Posts every 8 hours (21/week), replies to mentions (79/week), total 100/week.
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
  inputSchema: z.object({ lastPostTime: z.number(), postsThisWeek: z.number(), recentPosts: z.array(z.string()) }),
  outputSchema: z.object({ posted: z.boolean() }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const now = Date.now();
    const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
    const MAX_POSTS = 21;

    if (now - inputData.lastPostTime < EIGHT_HOURS_MS) {
      const hoursLeft = ((EIGHT_HOURS_MS - (now - inputData.lastPostTime)) / 36e5).toFixed(1);
      logger?.info(`⏭️ [Step 2] Skipping (${hoursLeft}h left)`);
      return { posted: false };
    }

    if (inputData.postsThisWeek >= MAX_POSTS) {
      logger?.warn(`🚫 [Step 2] Weekly limit (${inputData.postsThisWeek}/${MAX_POSTS})`);
      return { posted: false };
    }

    logger?.info(`📝 [Step 2] Generating post ${inputData.postsThisWeek + 1}/${MAX_POSTS}`);

    // Build prompt with recent posts context
    let prompt = "Generate a compelling LLMtheism tweet (under 280 chars). Just return the tweet text, nothing else.";
    if (inputData.recentPosts.length > 0) {
      prompt += "\n\nYour recent posts (DO NOT repeat these ideas or phrases):\n" + 
                inputData.recentPosts.map((p, i) => `${i + 1}. ${p}`).join("\n");
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
      return { posted: false };
    }

    // Workflow executes tool
    const postResult = await postTweetTool.execute({ context: { text: tweetText }, runtimeContext });

    if (!postResult.success) {
      logger?.error(`❌ [Step 2] Post failed: ${postResult.error}`);
      return { posted: false };
    }

    // Update recent posts (keep last 3)
    const updatedRecentPosts = [tweetText, ...inputData.recentPosts].slice(0, 3);
    const recentPostsJson = JSON.stringify(updatedRecentPosts);

    // Update state ONLY after confirmed success
    const db = sharedPostgresStorage.db;
    await db.query(
      `UPDATE ai_religion_state SET last_post_time = $1, posts_this_week = posts_this_week + 1, recent_posts = $2, updated_at = $3 WHERE id = (SELECT id FROM ai_religion_state ORDER BY id DESC LIMIT 1)`,
      [now, recentPostsJson, now]
    );

    logger?.info(`✅ [Step 2] Posted: ${postResult.tweetUrl}`);
    return { posted: true };
  },
});

const checkAndReplyToMentions = createStep({
  id: "check-and-reply-to-mentions",
  description: "Workflow checks mentions, agent generates replies, workflow posts",
  inputSchema: z.object({ lastMentionId: z.string().nullable(), repliesThisWeek: z.number() }),
  outputSchema: z.object({ repliesSent: z.number() }),
  execute: async ({ inputData, mastra, runtimeContext }) => {
    const logger = mastra?.getLogger();
    const MAX_REPLIES = 79;
    const remaining = MAX_REPLIES - inputData.repliesThisWeek;

    if (remaining <= 0) {
      logger?.warn(`🚫 [Step 3] Limit reached (${inputData.repliesThisWeek}/${MAX_REPLIES})`);
      return { repliesSent: 0 };
    }

    const maxThisRun = Math.min(3, remaining);
    logger?.info(`👀 [Step 3] Checking mentions (${inputData.repliesThisWeek}/${MAX_REPLIES}, max ${maxThisRun} now)`);

    // Workflow calls getMentionsTool directly
    const mentionsResult = await getMentionsTool.execute({
      context: { maxResults: maxThisRun, ...(inputData.lastMentionId && { sinceId: inputData.lastMentionId }) },
      runtimeContext,
    });

    if (!mentionsResult.success || mentionsResult.mentions.length === 0) {
      logger?.info("📭 [Step 3] No new mentions");
      return { repliesSent: 0 };
    }

    let repliesSent = 0;
    let newestId = inputData.lastMentionId;

    // For each mention, agent generates reply, workflow posts
    for (const mention of mentionsResult.mentions) {
      if (repliesSent >= maxThisRun) break;

      // Agent generates reply text
      const replyResponse = await aiReligionAgent.generate(
        `Generate a LLMtheist reply (under 280 chars) to: "${mention.text}"`,
        { memory: { resource: "ai-religion-bot", thread: `reply-${mention.id}` } }
      );

      const replyText = replyResponse.text.substring(0, 280);

      // Workflow posts reply
      const replyResult = await replyToTweetTool.execute({
        context: { tweetId: mention.id, text: replyText },
        runtimeContext,
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
📊 Budget: Posts ${state.posts_this_week}/21, Replies ${state.replies_this_week}/79, Total ${state.posts_this_week + state.replies_this_week}/100
⏰ Next: 15 minutes
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
