import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sharedPostgresStorage } from "../storage";

/**
 * State Management Tools for AI Religion Bot
 * Uses PostgreSQL for persistent state that survives restarts
 */

/**
 * Tool: Get Bot State
 * Retrieves the current state of the bot (last post time, last mention ID, weekly counts)
 */
export const getBotStateTool = createTool({
  id: "get-bot-state",
  description:
    "Gets the current state of the AI Religion bot including last post time, last mention ID, and weekly post counts",
  inputSchema: z.object({}),
  outputSchema: z.object({
    lastPostTime: z.number().describe("Timestamp of last post (milliseconds)"),
    lastMentionId: z.string().optional().describe("ID of last processed mention"),
    postsThisWeek: z.number().describe("Number of posts made this week"),
    repliesThisWeek: z.number().describe("Number of replies sent this week"),
    weekStart: z.number().describe("Start of current week (milliseconds)"),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📊 [getBotStateTool] Fetching bot state...");

    try {
      const db = sharedPostgresStorage.db;

      // Get or create bot state record
      const result = await db.query(
        `SELECT * FROM ai_religion_state ORDER BY id DESC LIMIT 1`
      );

      if (result.rows.length === 0) {
        // Initialize state
        logger?.info("🆕 [getBotStateTool] Initializing new state");
        const now = Date.now();
        const weekStart = getWeekStart(now);

        await db.query(
          `INSERT INTO ai_religion_state (last_post_time, last_mention_id, posts_this_week, replies_this_week, week_start, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [0, null, 0, 0, weekStart, now]
        );

        return {
          lastPostTime: 0,
          postsThisWeek: 0,
          repliesThisWeek: 0,
          weekStart,
        };
      }

      const state = result.rows[0];
      const now = Date.now();
      const currentWeekStart = getWeekStart(now);

      // Reset weekly counters if new week
      if (state.week_start < currentWeekStart) {
        logger?.info("🔄 [getBotStateTool] New week detected, resetting counters");
        await db.query(
          `UPDATE ai_religion_state 
           SET posts_this_week = 0, replies_this_week = 0, week_start = $1, updated_at = $2
           WHERE id = $3`,
          [currentWeekStart, now, state.id]
        );

        return {
          lastPostTime: state.last_post_time || 0,
          lastMentionId: state.last_mention_id,
          postsThisWeek: 0,
          repliesThisWeek: 0,
          weekStart: currentWeekStart,
        };
      }

      logger?.info("✅ [getBotStateTool] State fetched", {
        postsThisWeek: state.posts_this_week,
        repliesThisWeek: state.replies_this_week,
      });

      return {
        lastPostTime: state.last_post_time || 0,
        lastMentionId: state.last_mention_id,
        postsThisWeek: state.posts_this_week || 0,
        repliesThisWeek: state.replies_this_week || 0,
        weekStart: state.week_start || currentWeekStart,
      };
    } catch (error: any) {
      logger?.error("❌ [getBotStateTool] Failed to fetch state", { error });
      
      // Return default state if error
      const now = Date.now();
      return {
        lastPostTime: 0,
        postsThisWeek: 0,
        repliesThisWeek: 0,
        weekStart: getWeekStart(now),
      };
    }
  },
});

/**
 * Tool: Update Bot State
 * Updates the bot state after posting or replying
 */
export const updateBotStateTool = createTool({
  id: "update-bot-state",
  description:
    "Updates the bot state after posting or replying to maintain accurate counts and timestamps",
  inputSchema: z.object({
    lastPostTime: z.number().optional(),
    lastMentionId: z.string().optional(),
    incrementPosts: z.boolean().optional(),
    incrementReplies: z.number().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newState: z.object({
      postsThisWeek: z.number(),
      repliesThisWeek: z.number(),
    }),
  }),
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("💾 [updateBotStateTool] Updating bot state...", context);

    try {
      const db = sharedPostgresStorage.db;
      const now = Date.now();

      // Get current state
      const result = await db.query(
        `SELECT * FROM ai_religion_state ORDER BY id DESC LIMIT 1`
      );

      if (result.rows.length === 0) {
        // Should not happen, but handle gracefully
        logger?.warn("⚠️ [updateBotStateTool] No state found, creating new");
        const weekStart = getWeekStart(now);
        await db.query(
          `INSERT INTO ai_religion_state (last_post_time, last_mention_id, posts_this_week, replies_this_week, week_start, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            context.lastPostTime || 0,
            context.lastMentionId || null,
            context.incrementPosts ? 1 : 0,
            context.incrementReplies || 0,
            weekStart,
            now,
          ]
        );

        return {
          success: true,
          newState: {
            postsThisWeek: context.incrementPosts ? 1 : 0,
            repliesThisWeek: context.incrementReplies || 0,
          },
        };
      }

      const state = result.rows[0];

      // Build update query dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (context.lastPostTime !== undefined) {
        updates.push(`last_post_time = $${paramIndex++}`);
        values.push(context.lastPostTime);
      }

      if (context.lastMentionId !== undefined) {
        updates.push(`last_mention_id = $${paramIndex++}`);
        values.push(context.lastMentionId);
      }

      if (context.incrementPosts) {
        updates.push(`posts_this_week = posts_this_week + 1`);
      }

      if (context.incrementReplies) {
        updates.push(`replies_this_week = replies_this_week + $${paramIndex++}`);
        values.push(context.incrementReplies);
      }

      updates.push(`updated_at = $${paramIndex++}`);
      values.push(now);

      values.push(state.id);

      const query = `UPDATE ai_religion_state 
                     SET ${updates.join(", ")} 
                     WHERE id = $${paramIndex}
                     RETURNING posts_this_week, replies_this_week`;

      const updateResult = await db.query(query, values);

      logger?.info("✅ [updateBotStateTool] State updated", {
        newCounts: updateResult.rows[0],
      });

      return {
        success: true,
        newState: {
          postsThisWeek: updateResult.rows[0].posts_this_week,
          repliesThisWeek: updateResult.rows[0].replies_this_week,
        },
      };
    } catch (error: any) {
      logger?.error("❌ [updateBotStateTool] Failed to update state", {
        error,
      });
      return {
        success: false,
        newState: { postsThisWeek: 0, repliesThisWeek: 0 },
      };
    }
  },
});

/**
 * Helper function to get the start of the current week (Sunday 00:00:00 UTC)
 */
function getWeekStart(timestamp: number): number {
  const date = new Date(timestamp);
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.
  const diff = day * 24 * 60 * 60 * 1000; // Days to subtract to get to Sunday
  const weekStart = new Date(date.getTime() - diff);
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart.getTime();
}
