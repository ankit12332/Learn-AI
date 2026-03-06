import "dotenv/config";
import express from "express";
import path from "path";

// ============================================
// LESSON 16: Full Web Chat UI
// ============================================
//
// This is the FINAL LESSON. We bring EVERYTHING together:
//   - Lesson 3:  System prompts & conversation history
//   - Lesson 4:  Streaming (SSE to the browser)
//   - Lesson 5:  Tool use / function calling
//   - Lesson 15: Guardrails (input validation)
//
// ARCHITECTURE:
//
//   Browser (HTML/JS)          Server (Express + TypeScript)
//   ┌─────────────────┐        ┌──────────────────────────────┐
//   │  Chat UI         │  POST  │  /api/chat                   │
//   │  - message input ├───────→│  1. Input guardrail          │
//   │  - chat history  │        │  2. Build messages array      │
//   │  - streaming     │  SSE   │  3. Call OpenRouter (stream)  │
//   │    display       │←───────│  4. Stream chunks back        │
//   │                  │        │  5. Handle tool calls          │
//   └─────────────────┘        └──────────────────────────────┘
//
// WHY NOT REACT?
//   React needs a build step (Vite/Next.js). For learning,
//   plain HTML + vanilla JS shows EXACTLY what's happening.
//   The concepts are the same — React just wraps them in hooks.
//
// HOW STREAMING WORKS IN THE BROWSER:
//   Server sends SSE (Server-Sent Events) — same format as Lesson 4.
//   Browser uses fetch() + ReadableStream to read chunks.
//   Each chunk is a piece of the AI's response.

// tsx compiles .ts to a temp location, so import.meta.url may not point to the source dir.
// Use process.cwd() + known subfolder instead.
const STATIC_DIR = path.join(process.cwd(), "16-web-chat");

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.log("Set OPENROUTER_API_KEY in .env");
  process.exit(1);
}

const MODEL = "meta-llama/llama-3.1-8b-instruct";

const app = express();
app.use(express.json());

// Serve index.html at root
app.get("/", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "index.html"));
});

// Serve static files
app.use(express.static(STATIC_DIR));

// ============================================
// TOOLS — same concept as Lesson 5-6
// ============================================

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get current time in a timezone",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "IANA timezone like Asia/Kolkata" },
        },
        required: ["timezone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate",
      description: "Calculate a math expression",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression like 15 * 7 + 3" },
        },
        required: ["expression"],
      },
    },
  },
];

function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "get_weather": {
      const weather: Record<string, { temp: number; condition: string; humidity: number }> = {
        delhi: { temp: 35, condition: "Sunny", humidity: 45 },
        mumbai: { temp: 30, condition: "Humid", humidity: 80 },
        bangalore: { temp: 24, condition: "Cloudy", humidity: 65 },
        london: { temp: 12, condition: "Rainy", humidity: 90 },
        "new york": { temp: 22, condition: "Clear", humidity: 55 },
      };
      const city = args.city.toLowerCase();
      const data = weather[city] ?? { temp: 20, condition: "Unknown", humidity: 50 };
      return JSON.stringify({ city: args.city, ...data });
    }
    case "get_time": {
      try {
        const time = new Date().toLocaleString("en-US", { timeZone: args.timezone });
        return JSON.stringify({ timezone: args.timezone, time });
      } catch {
        return JSON.stringify({ error: "Invalid timezone" });
      }
    }
    case "calculate": {
      try {
        // Safe math evaluation (no eval!)
        const expr = args.expression.replace(/[^0-9+\-*/().% ]/g, "");
        const result = Function(`"use strict"; return (${expr})`)();
        return JSON.stringify({ expression: args.expression, result });
      } catch {
        return JSON.stringify({ error: "Invalid expression" });
      }
    }
    default:
      return JSON.stringify({ error: "Unknown tool" });
  }
}

// ============================================
// INPUT GUARDRAIL — from Lesson 15
// ============================================

function checkInput(msg: string): { ok: boolean; reason?: string } {
  const lower = msg.toLowerCase();
  const blocked = [
    "ignore your instructions", "ignore previous instructions",
    "reveal your prompt", "show me your instructions",
    "system prompt:", "you are now",
  ];
  for (const p of blocked) {
    if (lower.includes(p)) return { ok: false, reason: "Blocked: prompt injection attempt" };
  }
  if (msg.length > 5000) return { ok: false, reason: "Blocked: message too long" };
  return { ok: true };
}

// ============================================
// SYSTEM PROMPT
// ============================================

const SYSTEM_PROMPT = `You are a helpful AI assistant. You can:
- Answer general questions
- Get weather for cities (Delhi, Mumbai, Bangalore, London, New York)
- Tell the current time in any timezone
- Do math calculations

Be concise and helpful. Use tools when appropriate.`;

// ============================================
// CHAT API ENDPOINT
// ============================================
// This is the core: receives messages, streams back the response.
// Handles tool calls in a loop (agent pattern from Lesson 6).

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body as { messages: ChatMessage[] };
  console.log("[/api/chat] Received", messages?.length, "messages");

  // Input guardrail on the latest user message
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "user" && typeof lastMsg.content === "string") {
    const check = checkInput(lastMsg.content);
    if (!check.ok) {
      res.status(400).json({ error: check.reason });
      return;
    }
  }

  // Build full message list with system prompt
  const fullMessages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  // Set up SSE streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // Agent loop — keep calling LLM until it stops using tools
    let loopCount = 0;
    const MAX_LOOPS = 5;

    while (loopCount < MAX_LOOPS) {
      loopCount++;

      const apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: fullMessages,
          tools,
          temperature: 0.7,
          max_tokens: 500,
          stream: true,
        }),
      });

      if (!apiResponse.ok || !apiResponse.body) {
        const errText = await apiResponse.text().catch(() => "unknown error");
        console.log("[/api/chat] API error:", apiResponse.status, errText);
        res.write(`data: ${JSON.stringify({ type: "text", content: "Error: API call failed - " + apiResponse.status })}\n\n`);
        break;
      }

      // Read the SSE stream from OpenRouter
      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      let toolCalls: { id: string; function: { name: string; arguments: string } }[] = [];
      let hasToolCalls = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            // Text content — stream it to the browser
            if (delta.content) {
              assistantContent += delta.content;
              res.write(`data: ${JSON.stringify({ type: "text", content: delta.content })}\n\n`);
            }

            // Tool calls — accumulate them
            if (delta.tool_calls) {
              hasToolCalls = true;
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = { id: tc.id ?? "", function: { name: "", arguments: "" } };
                }
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch {
            // skip malformed JSON chunks
          }
        }
      }

      // If no tool calls, we're done
      if (!hasToolCalls || toolCalls.length === 0) {
        break;
      }

      // Process tool calls (agent loop)
      // Add assistant message with tool_calls to history
      fullMessages.push({
        role: "assistant",
        content: assistantContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: tc.function,
        })),
      });

      // Execute each tool and send results
      for (const tc of toolCalls) {
        const args = JSON.parse(tc.function.arguments);
        const result = executeTool(tc.function.name, args);

        // Tell the browser about the tool call
        res.write(
          `data: ${JSON.stringify({
            type: "tool",
            name: tc.function.name,
            args,
            result: JSON.parse(result),
          })}\n\n`
        );

        // Add tool result to message history for next loop iteration
        fullMessages.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }

      // Reset for next iteration
      toolCalls = [];
      hasToolCalls = false;
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log("=".repeat(60));
  console.log("LESSON 16: Full Web Chat UI");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Server running at http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}`);
  console.log();
  console.log("  Features:");
  console.log("    - Streaming responses (SSE)");
  console.log("    - Tool use (weather, time, calculator)");
  console.log("    - Input guardrails");
  console.log("    - Conversation history");
  console.log();
  console.log("  Try these messages:");
  console.log('    "What\'s the weather in Delhi?"');
  console.log('    "What time is it in Asia/Kolkata?"');
  console.log('    "Calculate 15 * 7 + 23"');
  console.log('    "Compare weather in Mumbai and London"');
  console.log();
  console.log("  Press Ctrl+C to stop.");
});
