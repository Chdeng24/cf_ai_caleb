# 🤖 Chat Agent Starter Kit

![npm i agents command](./npm-agents-banner.svg)

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agents-starter"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"/></a>

A starter template for building AI-powered chat agents using Cloudflare's Agent platform, powered by [`agents`](https://www.npmjs.com/package/agents). This project provides a foundation for creating interactive chat experiences with AI, complete with a modern UI and tool integration capabilities.

## Features

- 💬 Interactive chat interface with AI powered by **Workers AI** (Llama 3.3)
- 🤖 **Automated Message Summarization** - AI-generated summaries every minute via Cloudflare Workflows
- 🛠️ Built-in tool system with human-in-the-loop confirmation
- 📅 Advanced task scheduling (one-time, delayed, and recurring via cron)
- 🌓 Dark/Light theme support
- ⚡️ Real-time streaming responses
- 🔄 State management and chat history (Durable Objects)
- 🎨 Modern, responsive UI
- ⚙️ **Workflow Orchestration** - Multi-step automated tasks with retry logic

## Prerequisites

- Cloudflare account (for Workers AI, Workflows, and Durable Objects)
- No API keys required - uses Cloudflare Workers AI (no OpenAI needed)

## Quick Start

1. Create a new project:

```bash
npx create-cloudflare@latest --template cloudflare/agents-starter
```

2. Install dependencies:

```bash
npm install
```

3. Run locally:

```bash
npm start
```

5. Deploy:

```bash
npm run deploy
```

## Project Structure

```
├── src/
│   ├── app.tsx        # Chat UI implementation
│   ├── server.ts      # Chat agent logic with summary endpoints
│   ├── workflows.ts   # Automated message summarization workflow
│   ├── tools.ts       # Tool definitions (weather, scheduling, etc.)
│   ├── utils.ts       # Helper functions
│   └── styles.css     # UI styling
├── wrangler.jsonc     # Cloudflare configuration (Workflows, AI binding, cron)
└── package.json       # Dependencies (workers-ai-provider, agents SDK)
```

## 🤖 Automated Message Summarization

This project includes an **automated message summarization feature** that demonstrates Cloudflare Workflows, Workers AI, and Durable Objects working together.

### How It Works

Every minute (in production), a Cloudflare Workflow:
1. **Fetches messages** from the chat agent (Durable Object)
2. **Generates a summary** using Workers AI (Llama 3.3)
3. **Displays the summary** as a message in the chat UI
4. **Stores summaries** in persistent state

### Architecture

- **Workflows** (`src/workflows.ts`): Orchestrates the multi-step summarization process
- **Cron Trigger**: Runs every minute (`* * * * *` in `wrangler.jsonc`)
- **Workers AI**: Uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for summarization
- **Durable Objects**: Stores chat history and summary state
- **Automatic Retries**: Built-in retry logic for each workflow step

### Testing the Automation

#### Local Development

Cron triggers don't fire automatically in `wrangler dev`. To test locally:

1. **Start the development server:**
   ```bash
   npm start
   # or
   npx wrangler dev
   ```

2. **Have a conversation** - Send a few messages in the chat

3. **Manually trigger a summary:**
   ```bash
   curl -X POST http://localhost:8787/api/trigger-summary
   ```

4. **Check the chat** - A summary message will appear within a few seconds:
   ```
   📋 **Conversation Summary**
   
   [AI-generated summary of your conversation]
   
   _Generated automatically_
   ```

#### Production Deployment

After deployment, summaries are generated **automatically every minute**:

```bash
npm run deploy
```

Once deployed:
- ✅ Cron trigger fires automatically every minute
- ✅ Workflow generates summaries when messages exist
- ✅ Summaries appear in chat automatically
- ✅ No manual intervention needed

### Workflow Steps

The summarization workflow consists of 5 steps:

1. **fetch-messages** - Retrieves chat history from Durable Object
2. **format-messages** - Formats recent messages for AI processing
3. **generate-summary** - Uses Workers AI to create a concise summary
4. **save-and-display-summary** - Stores summary in state and displays in chat
5. **completion** - Returns success status

Each step includes:
- Automatic retries with exponential backoff
- Timeout protection
- Error handling
- Console logging for observability

### Configuration

The automation is configured in `wrangler.jsonc`:

```jsonc
{
  "workflows": [
    {
      "name": "MESSAGE_SUMMARY_WORKFLOW",
      "binding": "MESSAGE_SUMMARY_WORKFLOW",
      "class_name": "MessageSummaryWorkflow"
    }
  ],
  "triggers": {
    "crons": ["* * * * *"]  // Runs every minute
  },
  "ai": {
    "binding": "AI",
    "remote": true
  }
}
```

### Viewing Workflow Logs

Check the Cloudflare dashboard or local console for workflow execution logs:
- `[timestamp] Triggering message summary workflow...`
- `Fetched X messages from agent: default`
- `Generated summary: [preview]...`
- `Summary saved and displayed successfully`

## Customization Guide

### Adding New Tools

Add new tools in `tools.ts` using the tool builder:

```ts
// Example of a tool that requires confirmation
const searchDatabase = tool({
  description: "Search the database for user records",
  parameters: z.object({
    query: z.string(),
    limit: z.number().optional()
  })
  // No execute function = requires confirmation
});

// Example of an auto-executing tool
const getCurrentTime = tool({
  description: "Get current server time",
  parameters: z.object({}),
  execute: async () => new Date().toISOString()
});

// Scheduling tool implementation
const scheduleTask = tool({
  description:
    "schedule a task to be executed at a later time. 'when' can be a date, a delay in seconds, or a cron pattern.",
  parameters: z.object({
    type: z.enum(["scheduled", "delayed", "cron"]),
    when: z.union([z.number(), z.string()]),
    payload: z.string()
  }),
  execute: async ({ type, when, payload }) => {
    // ... see the implementation in tools.ts
  }
});
```

To handle tool confirmations, add execution functions to the `executions` object:

```typescript
export const executions = {
  searchDatabase: async ({
    query,
    limit
  }: {
    query: string;
    limit?: number;
  }) => {
    // Implementation for when the tool is confirmed
    const results = await db.search(query, limit);
    return results;
  }
  // Add more execution handlers for other tools that require confirmation
};
```

Tools can be configured in two ways:

1. With an `execute` function for automatic execution
2. Without an `execute` function, requiring confirmation and using the `executions` object to handle the confirmed action. NOTE: The keys in `executions` should match `toolsRequiringConfirmation` in `app.tsx`.

### AI Model Provider

This project uses **Cloudflare Workers AI** with the Llama 3.3 model via the `workers-ai-provider`. This means:

- ✅ **No API keys required** - Uses Cloudflare's Workers AI binding
- ✅ **No external dependencies** - Everything runs on Cloudflare's edge
- ✅ **Fast responses** - Optimized for edge computing
- ✅ **Cost-effective** - No per-token charges

The model used: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`

You can switch to a different Workers AI model by changing the model identifier in `src/server.ts`:

```typescript
const model = workersai("@cf/meta/llama-3.1-8b-instruct" as any);
```

Available models: [Cloudflare Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)

### Using a different AI model provider

If you want to use OpenAI, Anthropic, or another provider instead:

1. Installing an alternative AI provider for the `ai-sdk`, such as the [`workers-ai-provider`](https://sdk.vercel.ai/providers/community-providers/cloudflare-workers-ai) or [`anthropic`](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic) provider:
2. Replacing the AI SDK with the [OpenAI SDK](https://github.com/openai/openai-node)
3. Using the Cloudflare [Workers AI + AI Gateway](https://developers.cloudflare.com/ai-gateway/providers/workersai/#workers-binding) binding API directly

For example, to use the [`workers-ai-provider`](https://sdk.vercel.ai/providers/community-providers/cloudflare-workers-ai), install the package:

```sh
npm install workers-ai-provider
```

Add an `ai` binding to `wrangler.jsonc`:

```jsonc
// rest of file
  "ai": {
    "binding": "AI"
  }
// rest of file
```

Replace the `@ai-sdk/openai` import and usage with the `workers-ai-provider`:

```diff
// server.ts
// Change the imports
- import { openai } from "@ai-sdk/openai";
+ import { createWorkersAI } from 'workers-ai-provider';

// Create a Workers AI instance
+ const workersai = createWorkersAI({ binding: env.AI });

// Use it when calling the streamText method (or other methods)
// from the ai-sdk
- const model = openai("gpt-4o-2024-11-20");
+ const model = workersai("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b")
```

Commit your changes and then run the `agents-starter` as per the rest of this README.

### Modifying the UI

The chat interface is built with React and can be customized in `app.tsx`:

- Modify the theme colors in `styles.css`
- Add new UI components in the chat container
- Customize message rendering and tool confirmation dialogs
- Add new controls to the header

### Example Use Cases

1. **Customer Support Agent**
   - Add tools for:
     - Ticket creation/lookup
     - Order status checking
     - Product recommendations
     - FAQ database search

2. **Development Assistant**
   - Integrate tools for:
     - Code linting
     - Git operations
     - Documentation search
     - Dependency checking

3. **Data Analysis Assistant**
   - Build tools for:
     - Database querying
     - Data visualization
     - Statistical analysis
     - Report generation

4. **Personal Productivity Assistant**
   - Implement tools for:
     - Task scheduling with flexible timing options
     - One-time, delayed, and recurring task management
     - Task tracking with reminders
     - Email drafting
     - Note taking

5. **Scheduling Assistant**
   - Build tools for:
     - One-time event scheduling using specific dates
     - Delayed task execution (e.g., "remind me in 30 minutes")
     - Recurring tasks using cron patterns
     - Task payload management
     - Flexible scheduling patterns

Each use case can be implemented by:

1. Adding relevant tools in `tools.ts`
2. Customizing the UI for specific interactions
3. Extending the agent's capabilities in `server.ts`
4. Adding any necessary external API integrations

## Assignment Requirements ✅

This project demonstrates all required components for an AI-powered Cloudflare application:

- ✅ **LLM**: Uses Workers AI with Llama 3.3 (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- ✅ **Workflow/Coordination**: Cloudflare Workflows for automated message summarization
- ✅ **User Input**: Interactive chat interface with real-time streaming
- ✅ **Memory/State**: Durable Objects for persistent chat history and state management

### Key Technologies

- **Workers AI**: AI inference at the edge
- **Workflows**: Durable, orchestrated multi-step automation
- **Durable Objects**: Strongly consistent state and chat persistence
- **Agents SDK**: Chat agent framework with built-in memory

## Deployment

### Quick Deploy

```bash
npm run deploy
```

This will:
1. Build the project
2. Deploy to Cloudflare Workers
3. Enable cron triggers (summaries run automatically)
4. Configure all bindings (AI, Workflows, Durable Objects)

### Deployed Link

After deployment, your app will be available at:
```
https://agents-starter.YOUR_SUBDOMAIN.workers.dev
```

The automation (summaries) will run automatically every minute once deployed.

## Troubleshooting

### Summaries not appearing locally?

**Solution**: Cron triggers don't work in local dev. Use the manual trigger endpoint:
```bash
curl -X POST http://localhost:8787/api/trigger-summary
```

### Workflow errors?

Check:
1. Workers AI binding is configured in `wrangler.jsonc`
2. Workflow class is properly exported in `src/workflows.ts`
3. Durable Object migrations are applied
4. Console logs for detailed error messages

### No messages to summarize?

The workflow only generates summaries when there are messages. Have a conversation first, then trigger a summary.

## Learn More

- [`agents`](https://github.com/cloudflare/agents/blob/main/packages/agents/README.md)
- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)

## License

MIT
