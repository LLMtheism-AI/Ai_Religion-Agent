# Overview

This is a Mastra-based AI automation project built on the Replit platform. Mastra is an all-in-one TypeScript framework for building AI-powered applications and agents. The project enables users to create durable, event-driven automations using AI agents, tools, and workflows with built-in support for memory, streaming, and human-in-the-loop interactions.

The application is designed to run AI automations triggered by either time-based schedules or webhook events from third-party services (Slack, Telegram, etc.). It uses Inngest for durable workflow execution and provides a specialized Replit Playground UI for visual workflow inspection and testing.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Core Framework
- **Mastra Framework**: TypeScript-based AI framework providing unified interfaces for agents, tools, workflows, and model routing
- **Node.js Runtime**: Requires Node.js >=20.9.0 with ES2022 module system
- **TypeScript**: Strict mode enabled with ES2022 target and bundler module resolution

## AI Model Integration
- **Multi-Provider Support**: Unified model router accessing 47+ providers and 803+ models through single API
- **Primary Providers**: OpenAI, Anthropic, Google Gemini, xAI, OpenRouter
- **AI SDK Integration**: Supports both Vercel AI SDK v4 (legacy) and v5 with compatibility layers
- **Model Selection Strategy**: Mix-and-match approach with fallback capabilities for provider outages

## Agent Architecture
- **Agent System**: LLM-powered agents with tool execution, memory management, and reasoning capabilities
- **Agent Networks**: Multi-agent coordination through routing agents that delegate tasks based on descriptions and schemas
- **Memory Types**:
  - Conversation history (recent messages, default 10)
  - Semantic recall (RAG-based vector search for long-term context)
  - Working memory (persistent user data and preferences with thread/resource scoping)
- **Guardrails**: Input/output processors for content moderation, prompt injection prevention, and response sanitization

## Workflow Engine
- **Workflow Composition**: Graph-based workflows with explicit step sequencing using `createWorkflow` and `createStep`
- **Execution Patterns**: Sequential chaining (`.then()`), parallel execution (`.parallel()`), conditional branching (`.condition()`)
- **Control Flow**: Suspend/resume capabilities for human-in-the-loop interactions with snapshot persistence
- **Data Flow**: Explicit input/output schemas with `.map()` transformations between steps
- **Error Handling**: Configurable retry mechanisms at workflow and step levels

## Durability & Orchestration
- **Inngest Integration**: Custom durability layer providing step memoization, automatic retries, and resume-from-failure capabilities
- **Workflow Snapshots**: Serialized execution state stored in configured storage for suspend/resume operations
- **Real-time Monitoring**: Publish-subscribe system for workflow execution events and step-level observability

## Storage & Persistence
- **Storage Adapters**: Pluggable storage system supporting LibSQL, PostgreSQL, and Upstash Redis
- **Memory Storage**: Conversation threads, messages, and working memory persisted across application restarts
- **Thread/Resource Model**: Two-tier scoping system for memory isolation (thread-scoped vs resource-scoped)
- **Vector Storage**: Integration with vector databases (LibSQL Vector, PostgreSQL pgvector, Upstash Vector) for semantic recall

## Streaming Architecture
- **Agent Streaming**: Real-time incremental responses with `textStream` for progressive output delivery
- **Workflow Streaming**: Step-by-step execution visibility with writer argument for custom event emission
- **Tool Streaming**: Intermediate result streaming from tool execution for progress feedback
- **Event Types**: Comprehensive event system including text-delta, tool-call, tool-result, step-start, step-finish, and network routing events

## Replit-Specific Features
- **Replit Playground UI**: Custom UI for workflow visualization and agent testing (user-facing, not agent-accessible)
- **Backward Compatibility**: Requires `generateLegacy()` and `streamLegacy()` methods for Playground UI compatibility
- **Deployment Integration**: Custom build and deployment pipeline for Replit infrastructure

## Trigger System
- **Time-based Triggers**: Cron-based scheduling for periodic workflow execution
- **Webhook Triggers**: HTTP endpoints for third-party service integrations (Slack, Telegram, Linear, GitHub, etc.)
- **Trigger Pattern**: Standardized `registerApiRoute` pattern with payload validation and error handling

## Logging & Observability
- **Logger System**: Pino-based production logger with structured JSON output and configurable log levels
- **Custom Logger**: Production-optimized PinoLogger extending MastraLogger with ISO timestamp formatting
- **Debug Levels**: Support for debug, info, warn, and error log levels with metadata

## Tool System
- **Tool Creation**: Zod-based schema validation for inputs/outputs with `createTool` function
- **Tool Integration**: Tools accessible to agents, workflows, and can be composed as workflow steps
- **Abort Signals**: Support for canceling long-running tool operations via AbortSignal propagation

# External Dependencies

## AI/ML Services
- **OpenAI**: GPT models for text generation and embeddings (requires `OPENAI_API_KEY`)
- **Anthropic**: Claude models for advanced reasoning (requires `ANTHROPIC_API_KEY`)
- **Google AI**: Gemini models integration
- **OpenRouter**: Multi-provider AI gateway for model fallbacks
- **xAI**: Grok model access
- **Exa**: Advanced search API integration (`exa-js` package)

## Database & Storage
- **LibSQL**: Embedded SQL database with vector search capabilities (`@mastra/libsql`)
- **PostgreSQL**: Optional production database with pgvector extension (`@mastra/pg`, `@types/pg`)
- **Upstash**: Redis and Vector database for serverless deployments (`@mastra/upstash`)

## Communication Platforms
- **Slack**: Webhook integration for message triggers (`@slack/web-api`)
- **Telegram**: Bot API integration for messaging (requires `TELEGRAM_BOT_TOKEN`)
- **Twitter**: API v2 integration (`twitter-api-v2`)

## Workflow & Orchestration
- **Inngest**: Durable workflow execution platform (`inngest`, `@mastra/inngest`, `inngest-cli`)
- **Inngest Realtime**: Real-time event streaming for workflow monitoring (`@inngest/realtime`)

## Mastra Ecosystem
- **@mastra/core**: Core framework functionality
- **@mastra/memory**: Memory management and persistence
- **@mastra/loggers**: Logging infrastructure
- **@mastra/mcp**: Model Context Protocol integration
- **mastra**: CLI for development, building, and deployment

## Development Tools
- **TypeScript**: Language and type system (`typescript`, `ts-node`)
- **TSX**: Fast TypeScript execution
- **Prettier**: Code formatting
- **Zod**: Runtime schema validation and type inference
- **Dotenv**: Environment variable management

## Configuration Notes
- All external API integrations require corresponding environment variables
- Model provider keys auto-detected from environment (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- Database connection strings configured via environment variables (e.g., `DATABASE_URL`)
- Webhook integrations require service-specific tokens and secrets