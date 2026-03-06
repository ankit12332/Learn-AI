import "dotenv/config";
import * as readline from "readline";

// ============================================
// LESSON 9: Build a Real Chat App (Terminal)
// ============================================
//
// Everything comes together:
//   - Multi-turn conversation (Lesson 3a: history management)
//   - Streaming (Lesson 4: real-time token delivery)
//   - System prompts (Lesson 3: controlling behavior)
//   - Tool use (Lesson 5-6: function calling + agent loop)
//   - Model routing (Lesson 8: pick the right model)
//
// We'll build a terminal chat app with:
//   1. Streaming responses (tokens appear live)
//   2. Conversation history (remembers context)
//   3. Tools (web search, calculator, time)
//   4. Slash commands (/clear, /model, /system, /history, /quit)

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

// ============================================
// State
// ============================================

let currentModel = "meta-llama/llama-3.1-8b-instruct";
let systemPrompt = "You are a helpful assistant. Be concise.";
const history: Message[] = [];

// ============================================
// Tools
// ============================================

const tools = [
  {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Evaluate a math expression. Use for any calculations.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression, e.g. '(23 + 17) * 4'" },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_current_time",
      description: "Get current date and time in a timezone",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "Timezone like 'Asia/Kolkata', 'America/New_York'. Default: UTC" },
        },
      },
    },
  },
];

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "calculator": {
      try {
        const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, "");
        const result = Function(`"use strict"; return (${sanitized})`)();
        return JSON.stringify({ expression: args.expression, result });
      } catch (e: any) {
        return JSON.stringify({ error: e.message });
      }
    }
    case "get_current_time": {
      const tz = args.timezone || "UTC";
      try {
        const time = new Date().toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "long" });
        return JSON.stringify({ timezone: tz, datetime: time });
      } catch {
        return JSON.stringify({ error: `Invalid timezone: ${tz}` });
      }
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ============================================
// Streaming chat with tool use loop
// ============================================

async function sendMessage(userInput: string): Promise<void> {
  history.push({ role: "user", content: userInput });

  const maxIterations = 5;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...history,
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: currentModel,
        messages,
        tools,
        temperature: 0.7,
        max_tokens: 1000,
        stream: true,
      }),
    });

    // Parse streaming response
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let toolCalls: ToolCall[] = [];

    // Track tool calls being built from stream deltas
    const toolCallBuilders: Map<number, { id: string; name: string; arguments: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk.choices?.[0]?.delta;

          // Text content
          if (delta?.content) {
            process.stdout.write(delta.content);
            fullContent += delta.content;
          }

          // Tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallBuilders.has(idx)) {
                toolCallBuilders.set(idx, { id: tc.id ?? "", name: "", arguments: "" });
              }
              const builder = toolCallBuilders.get(idx)!;
              if (tc.id) builder.id = tc.id;
              if (tc.function?.name) builder.name += tc.function.name;
              if (tc.function?.arguments) builder.arguments += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    // Build final tool calls array
    toolCalls = Array.from(toolCallBuilders.values()).map(b => ({
      id: b.id,
      type: "function" as const,
      function: { name: b.name, arguments: b.arguments },
    }));

    // If we got tool calls, execute them and loop
    if (toolCalls.length > 0) {
      const assistantMsg: Message = { role: "assistant", content: null, tool_calls: toolCalls };
      history.push(assistantMsg);

      for (const tc of toolCalls) {
        let args: Record<string, any>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        process.stdout.write(`\n  [tool: ${tc.function.name}(${JSON.stringify(args)})]\n`);
        const result = executeTool(tc.function.name, args);
        process.stdout.write(`  [result: ${result}]\n`);

        history.push({ role: "tool", tool_call_id: tc.id, content: result });
      }

      // Continue loop — LLM will see tool results
      continue;
    }

    // Text response — done
    if (fullContent) {
      history.push({ role: "assistant", content: fullContent });
      console.log(); // newline after streamed content
    }
    break;
  }
}

// ============================================
// Slash commands
// ============================================

function handleCommand(input: string): boolean {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case "/quit":
    case "/exit":
      console.log("Goodbye!");
      process.exit(0);

    case "/clear":
      history.length = 0;
      console.log("History cleared.");
      return true;

    case "/history":
      console.log(`Messages in history: ${history.length}`);
      for (const msg of history) {
        const preview = (msg.content ?? "[tool call]").slice(0, 60);
        console.log(`  [${msg.role}] ${preview}`);
      }
      return true;

    case "/model":
      if (parts[1]) {
        currentModel = parts[1];
        console.log(`Model changed to: ${currentModel}`);
      } else {
        console.log(`Current model: ${currentModel}`);
        console.log("Usage: /model <model-id>");
        console.log("Examples:");
        console.log("  /model meta-llama/llama-3.1-8b-instruct");
        console.log("  /model meta-llama/llama-3.3-70b-instruct");
        console.log("  /model anthropic/claude-sonnet-4");
      }
      return true;

    case "/system":
      if (parts.length > 1) {
        systemPrompt = parts.slice(1).join(" ");
        console.log(`System prompt updated: "${systemPrompt}"`);
      } else {
        console.log(`Current system prompt: "${systemPrompt}"`);
      }
      return true;

    case "/help":
      console.log("Commands:");
      console.log("  /model [id]    — view or change model");
      console.log("  /system [text] — view or change system prompt");
      console.log("  /history       — show conversation history");
      console.log("  /clear         — clear history");
      console.log("  /help          — show this help");
      console.log("  /quit          — exit");
      return true;

    default:
      return false;
  }
}

// ============================================
// Main REPL
// ============================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 9: Interactive Chat App");
  console.log("=".repeat(60));
  console.log();
  console.log(`Model: ${currentModel}`);
  console.log(`System: "${systemPrompt}"`);
  console.log("Tools: calculator, get_current_time");
  console.log("Type /help for commands, /quit to exit");
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { prompt(); return; }

      if (trimmed.startsWith("/")) {
        if (handleCommand(trimmed)) { prompt(); return; }
      }

      process.stdout.write("AI: ");
      try {
        await sendMessage(trimmed);
      } catch (e: any) {
        console.log(`\nError: ${e.message}`);
      }
      console.log();
      prompt();
    });
  };

  prompt();
}

main();
