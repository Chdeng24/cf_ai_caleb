import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
// Import workflow for registration
import "./workflows";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Create Workers AI provider instance with AI binding
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a helpful assistant that can do various tasks... 

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }

  /**
   * Handle HTTP requests to the agent (for Workflows to access messages)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Endpoint for workflows to get messages for summarization
    if (url.pathname === "/get-messages-summary" && request.method === "GET") {
      const messagesData = await this.getMessagesForSummary();
      return Response.json(messagesData);
    }

    // Endpoint for workflows to save summary
    if (url.pathname === "/save-summary" && request.method === "POST") {
      const { summary } = await request.json<{ summary: string }>();
      await this.saveSummary(summary);
      return Response.json({ success: true });
    }

    // Endpoint for workflows to add summary as a message (displays to users)
    if (url.pathname === "/add-summary-message" && request.method === "POST") {
      const { summary } = await request.json<{ summary: string }>();
      await this.addSummaryMessage(summary);
      return Response.json({ success: true });
    }

    // Fall back to default agent routing
    return super.fetch(request);
  }

  /**
   * Expose messages for external access (e.g., by Workflows)
   * Returns messages in a format suitable for summarization
   */
  async getMessagesForSummary() {
    // Filter only text messages (exclude tool calls for cleaner summary)
    const textMessages = this.messages
      .filter((msg) => msg.parts?.some((part) => part.type === "text"))
      .map((msg) => {
        const textParts = msg.parts?.filter((part) => part.type === "text") || [];
        return {
          role: msg.role,
          text: textParts.map((part: { type: string; text: string }) => part.text).join("\n"),
          timestamp: (msg.metadata as { createdAt?: string })?.createdAt || new Date().toISOString()
        };
      });

    return {
      messageCount: textMessages.length,
      messages: textMessages,
      lastSummarized: (this.state as { lastSummarized?: string })?.lastSummarized || null
    };
  }

  /**
   * Store a summary in the agent state
   */
  async saveSummary(summary: string) {
    const currentState = (this.state as { summaries?: string[]; lastSummarized?: string }) || {};
    const summaries = currentState.summaries || [];
    
    this.setState({
      ...currentState,
      summaries: [...summaries.slice(-9), summary], // Keep last 10 summaries
      lastSummarized: new Date().toISOString()
    });
  }

  /**
   * Add summary as an assistant message so it appears in the chat UI
   * This automatically shows the summary to users!
   */
  async addSummaryMessage(summary: string) {
    // Add summary as an assistant message with a special indicator
    const summaryMessage = {
      id: generateId(),
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: `📋 **Conversation Summary**\n\n${summary}\n\n_Generated automatically_`
        }
      ],
      metadata: {
        createdAt: new Date().toISOString(),
        isSummary: true // Mark as summary for potential special styling
      }
    };

    // Save the message - it will automatically appear in the chat UI!
    await this.saveMessages([...this.messages, summaryMessage]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Manual trigger endpoint for testing summaries locally
    // In production, the cron trigger handles this automatically
    if (url.pathname === "/api/trigger-summary" && request.method === "POST") {
      try {
        console.log(`[${new Date().toISOString()}] Manually triggering message summary workflow...`);
        
        const workflowInstance = await env.MESSAGE_SUMMARY_WORKFLOW.create({
          id: `summary-${Date.now()}`,
          params: {
            agentName: "default"
          }
        });

        return Response.json({ 
          success: true, 
          workflowId: workflowInstance.id,
          message: "Summary workflow triggered. Check chat for summary in a few seconds."
        });
      } catch (error) {
        console.error("Failed to trigger summary workflow:", error);
        return Response.json({ 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }, { status: 500 });
      }
    }

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },

  /**
   * Scheduled handler - triggers the message summary workflow every minute
   * This runs automatically based on the cron trigger in wrangler.jsonc
   */
  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[${new Date().toISOString()}] Triggering message summary workflow...`);

    try {
      // Create a new workflow instance to summarize messages
      const workflowInstance = await env.MESSAGE_SUMMARY_WORKFLOW.create({
        id: `summary-${Date.now()}`, // Unique ID for each run
        params: {
          agentName: "default" // Summarize the default chat agent
        }
      });

      console.log(`Workflow instance created: ${workflowInstance.id}`);

      // Note: The workflow runs asynchronously, we don't await it
      // This allows the scheduled handler to complete quickly
    } catch (error) {
      console.error("Failed to trigger summary workflow:", error);
      throw error; // Re-throw so Cloudflare retries the scheduled event
    }
  }
} satisfies ExportedHandler<Env>;
