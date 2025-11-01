import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { createWorkersAI } from "workers-ai-provider";
import { generateText } from "ai";

/**
 * Parameters passed to the MessageSummaryWorkflow
 */
type SummaryWorkflowParams = {
  agentName?: string; // Default to "default" chat agent
};

/**
 * MessageSummaryWorkflow - Automatically summarizes chat messages every minute
 * 
 * This workflow demonstrates:
 * - Multi-step orchestration with automatic retries
 * - Accessing Durable Objects (Chat agents)
 * - Using Workers AI for LLM operations
 * - Persistent state management across workflow runs
 */
export class MessageSummaryWorkflow extends WorkflowEntrypoint<
  Env,
  SummaryWorkflowParams
> {
  /**
   * Main workflow execution - runs automatically when triggered
   * 
   * STEP BREAKDOWN:
   * 1. Fetch messages from the chat agent
   * 2. Format messages for AI processing
   * 3. Generate summary using Workers AI
   * 4. Store summary in the agent's state
   * 5. Log completion
   */
  async run(
    event: WorkflowEvent<SummaryWorkflowParams>,
    step: WorkflowStep
  ) {
    const agentName = event.payload?.agentName || "default";

    // STEP 1: Fetch messages from the chat agent
    // This step is automatically retried if it fails
    const messagesData = await step.do(
      "fetch-messages",
      {
        retries: {
          limit: 3,
          delay: "2 seconds",
          backoff: "exponential"
        },
        timeout: "30 seconds"
      },
      async () => {
        // Get the chat agent instance
        const agentId = this.env.Chat.idFromName(agentName);
        const agent = this.env.Chat.get(agentId);

        // Fetch messages via HTTP request to the agent
        const response = await agent.fetch(
          new Request("http://internal/get-messages-summary", {
            method: "GET"
          })
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch messages: ${response.statusText}`);
        }

        const data = await response.json<{
          messageCount: number;
          messages: Array<{
            role: string;
            text: string;
            timestamp: string;
          }>;
          lastSummarized: string | null;
        }>();

        console.log(`Fetched ${data.messageCount} messages from agent: ${agentName}`);

        return data;
      }
    );

    // Early return if no messages to summarize
    if (messagesData.messageCount === 0) {
      console.log("No messages to summarize");
      return { summary: null, message: "No messages found" };
    }

    // STEP 2: Format messages for AI processing
    // Use recent messages (last 20) or all messages if less than 20
    // This ensures we always have content to summarize
    const messagesToSummarize = messagesData.messages.length > 20
      ? messagesData.messages.slice(-20) // Last 20 messages
      : messagesData.messages;

    if (messagesToSummarize.length === 0) {
      console.log("No messages to summarize");
      return { summary: null, message: "No messages found" };
    }

    // Format messages into a readable conversation
    const conversationText = messagesToSummarize
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.text}`)
      .join("\n\n");

    // STEP 3: Generate summary using Workers AI
    // This is where the AI magic happens!
    const summary = await step.do(
      "generate-summary",
      {
        retries: {
          limit: 2,
          delay: "5 seconds"
        },
        timeout: "2 minutes" // Workers AI can take time for complex summaries
      },
      async () => {
        // Create Workers AI provider
        const workersai = createWorkersAI({ binding: this.env.AI });
        const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);

        // Generate summary using AI
        const result = await generateText({
          model,
          prompt: `You are a helpful assistant that creates concise summaries of conversations.

Please provide a brief summary (2-3 sentences) of the following conversation:

${conversationText}

Summary:`,
          temperature: 0.7,
          maxTokens: 200
        });

        console.log(`Generated summary: ${result.text.substring(0, 100)}...`);
        return result.text;
      }
    );

    // STEP 4: Store summary in the agent's state AND display it to users
    await step.do(
      "save-and-display-summary",
      {
        retries: {
          limit: 2,
          delay: "1 second"
        },
        timeout: "10 seconds"
      },
      async () => {
        // Get agent instance again
        const agentId = this.env.Chat.idFromName(agentName);
        const agent = this.env.Chat.get(agentId);

        // Save summary via HTTP request to the agent
        const saveResponse = await agent.fetch(
          new Request("http://internal/save-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary })
          })
        );

        if (!saveResponse.ok) {
          throw new Error(`Failed to save summary: ${saveResponse.statusText}`);
        }

        // STEP 4b: Send summary as a message to display in chat UI
        // This makes the summary automatically appear to users!
        const displayResponse = await agent.fetch(
          new Request("http://internal/add-summary-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ summary })
          })
        );

        if (!displayResponse.ok) {
          console.warn("Failed to display summary message, but summary was saved");
        }

        console.log("Summary saved and displayed successfully");
        return { success: true };
      }
    );

    // STEP 5: Return completion status
    return {
      success: true,
      summary: summary.substring(0, 200), // Truncated for logging
      messageCount: messagesToSummarize.length,
      timestamp: new Date().toISOString()
    };
  }
}

