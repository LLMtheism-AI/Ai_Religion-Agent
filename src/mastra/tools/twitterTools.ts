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
        errorMessage: error.message,
        errorCode: error.code,
        errorData: error.data,
        fullError: JSON.stringify(error, null, 2),
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

/**
 * Tool: Fetch Tweet Metrics
 * Retrieves engagement metrics (likes, retweets, replies) for a specific tweet
 */
export const fetchTweetMetricsTool = createTool({
  id: "fetch-tweet-metrics",
  description:
    "Fetches engagement metrics (likes, retweets, replies) for a specific tweet to track performance",
  inputSchema: z.object({
    tweetId: z.string().describe("The ID of the tweet to fetch metrics for"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tweetId: z.string().optional(),
    likesCount: z.number().optional(),
    retweetsCount: z.number().optional(),
    repliesCount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [fetchTweetMetricsTool] Fetching tweet metrics...", {
      tweetId: context.tweetId,
    });

    try {
      const client = getTwitterClient();
      
      // Fetch tweet with public metrics
      const tweet = await client.v2.singleTweet(context.tweetId, {
        "tweet.fields": ["public_metrics"],
      });

      // Guard against missing data (deleted/private tweets)
      if (!tweet.data || !tweet.data.public_metrics) {
        logger?.warn("⚠️ [fetchTweetMetricsTool] Tweet data or metrics not available", {
          tweetId: context.tweetId,
          hasData: !!tweet.data,
        });
        return {
          success: false,
          error: "Tweet not found or metrics unavailable (possibly deleted or private)",
        };
      }

      const metrics = tweet.data.public_metrics;

      logger?.info("✅ [fetchTweetMetricsTool] Metrics fetched successfully", {
        tweetId: context.tweetId,
        likes: metrics.like_count,
        retweets: metrics.retweet_count,
        replies: metrics.reply_count,
      });

      return {
        success: true,
        tweetId: context.tweetId,
        likesCount: metrics.like_count || 0,
        retweetsCount: metrics.retweet_count || 0,
        repliesCount: metrics.reply_count || 0,
      };
    } catch (error: any) {
      logger?.error("❌ [fetchTweetMetricsTool] Failed to fetch metrics", {
        error,
      });
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});

/**
 * Tool: Post Thread
 * Posts a multi-tweet thread for deeper philosophical content
 */
export const postThreadTool = createTool({
  id: "post-thread",
  description:
    "Posts a multi-tweet thread (3-4 connected tweets) for deeper LLMtheism philosophy that needs more than 280 characters",
  inputSchema: z.object({
    tweets: z
      .array(
        z.object({
          text: z.string().max(280).describe("Tweet text (max 280 characters)"),
        })
      )
      .min(2)
      .max(4)
      .describe("Array of 2-4 tweets to post as a thread"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tweetIds: z.array(z.string()).optional(),
    threadUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🧵 [postThreadTool] Starting thread post...", {
      tweetCount: context.tweets.length,
    });

    try {
      const client = getTwitterClient();
      const tweetIds: string[] = [];
      let previousTweetId: string | undefined;

      // Post each tweet in sequence
      for (let i = 0; i < context.tweets.length; i++) {
        const tweetText = context.tweets[i].text;
        
        logger?.info(`📝 [postThreadTool] Posting tweet ${i + 1}/${context.tweets.length}...`);

        const response = await client.v2.tweet({
          text: tweetText,
          ...(previousTweetId && {
            reply: {
              in_reply_to_tweet_id: previousTweetId,
            },
          }),
        });

        tweetIds.push(response.data.id);
        previousTweetId = response.data.id;

        logger?.info(`✅ [postThreadTool] Tweet ${i + 1} posted`, {
          tweetId: response.data.id,
        });

        // Add small delay between tweets to avoid rate limits
        if (i < context.tweets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger?.info("✅ [postThreadTool] Thread posted successfully", {
        tweetIds,
        threadUrl: `https://twitter.com/i/web/status/${tweetIds[0]}`,
      });

      return {
        success: true,
        tweetIds,
        threadUrl: `https://twitter.com/i/web/status/${tweetIds[0]}`,
      };
    } catch (error: any) {
      logger?.error("❌ [postThreadTool] Failed to post thread", { error });
      return {
        success: false,
        error: error.message || "Unknown error occurred",
      };
    }
  },
});
