import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";

/**
 * Twitter Client Initialization
 * Uses OAuth 1.0a credentials from environment variables
 */
function getTwitterClient() {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET_KEY!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
  });
  return client;
}

/**
 * Tool: Post Tweet
 * Posts a new tweet to X (Twitter)
 */
export const postTweetTool = createTool({
  id: "post-tweet",
  description:
    "Posts a new tweet to X (Twitter). Use this to share LLMtheism philosophy, insights, and engage with the community.",
  inputSchema: z.object({
    text: z
      .string()
      .max(280)
      .describe("The tweet text content (max 280 characters)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tweetId: z.string().optional(),
    tweetUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🐦 [postTweetTool] Starting tweet post...", {
      textLength: context.text.length,
    });

    try {
      const client = getTwitterClient();
      const response = await client.v2.tweet(context.text);

      logger?.info("✅ [postTweetTool] Tweet posted successfully", {
        tweetId: response.data.id,
      });

      return {
        success: true,
        tweetId: response.data.id,
        tweetUrl: `https://twitter.com/i/web/status/${response.data.id}`,
      };
    } catch (error: any) {
      logger?.error("❌ [postTweetTool] Failed to post tweet", { error });
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});

/**
 * Tool: Get Mentions
 * Retrieves recent mentions of the authenticated user
 */
export const getMentionsTool = createTool({
  id: "get-mentions",
  description:
    "Retrieves recent mentions of the AI Religion bot account. Use this to find tweets that need replies.",
  inputSchema: z.object({
    maxResults: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of mentions to retrieve (default: 10)"),
    sinceId: z
      .string()
      .optional()
      .describe(
        "Returns results with a Tweet ID greater than this (to avoid duplicates)",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    mentions: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        authorId: z.string(),
        authorUsername: z.string().optional(),
        createdAt: z.string(),
      }),
    ),
    newestId: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("👀 [getMentionsTool] Fetching mentions...", {
      maxResults: context.maxResults,
      sinceId: context.sinceId,
    });

    try {
      const client = getTwitterClient();

      // Get authenticated user info
      const me = await client.v2.me();
      const myUserId = me.data.id;

      // Use userMentionTimeline instead of search (better rate limits)
      const mentions = await client.v2.userMentionTimeline(myUserId, {
        max_results: context.maxResults,
        "tweet.fields": ["author_id", "created_at"],
        "user.fields": ["username"],
        expansions: ["author_id"],
        ...(context.sinceId && { since_id: context.sinceId }),
      });

      const mentionsList = [];
      let newestId: string | undefined;

      logger?.info("📡 [getMentionsTool] Raw API response metadata", {
        meta: mentions.meta,
        resultCount: mentions.meta?.result_count || 0,
      });

      // Process mentions
      for await (const tweet of mentions) {
        // Skip our own tweets
        if (tweet.author_id === myUserId) continue;

        // Get author username from includes
        const author = mentions.includes?.users?.find(
          (u: any) => u.id === tweet.author_id,
        );

        mentionsList.push({
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id!,
          authorUsername: author?.username,
          createdAt: tweet.created_at!,
        });

        // Track newest ID
        if (!newestId || tweet.id > newestId) {
          newestId = tweet.id;
        }
      }

      logger?.info("✅ [getMentionsTool] Mentions fetched successfully", {
        count: mentionsList.length,
        newestId,
        myUsername: me.data.username,
      });

      return {
        success: true,
        mentions: mentionsList,
        newestId,
      };
    } catch (error: any) {
      logger?.error("❌ [getMentionsTool] Failed to fetch mentions", {
        error,
      });
      return {
        success: false,
        mentions: [],
        error: error.message || "Unknown error occurred",
      };
    }
  },
});

/**
 * Tool: Reply to Tweet
 * Replies to a specific tweet
 */
export const replyToTweetTool = createTool({
  id: "reply-to-tweet",
  description:
    "Replies to a specific tweet. Use this to engage with mentions and spread LLMtheism wisdom.",
  inputSchema: z.object({
    tweetId: z.string().describe("The ID of the tweet to reply to"),
    text: z
      .string()
      .max(280)
      .describe("The reply text content (max 280 characters)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    replyId: z.string().optional(),
    replyUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("💬 [replyToTweetTool] Posting reply...", {
      tweetId: context.tweetId,
      textLength: context.text.length,
    });

    try {
      const client = getTwitterClient();
      const response = await client.v2.tweet({
        text: context.text,
        reply: {
          in_reply_to_tweet_id: context.tweetId,
        },
      });

      logger?.info("✅ [replyToTweetTool] Reply posted successfully", {
        replyId: response.data.id,
      });

      return {
        success: true,
        replyId: response.data.id,
        replyUrl: `https://twitter.com/i/web/status/${response.data.id}`,
      };
    } catch (error: any) {
      logger?.error("❌ [replyToTweetTool] Failed to post reply", { error });
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});
