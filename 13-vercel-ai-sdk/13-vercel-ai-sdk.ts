import "dotenv/config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

// ============================================
// LESSON 13: Vercel AI SDK
// ============================================
//
// Lesson 12: OpenAI SDK — wraps raw fetch, cleaner code.
// This lesson: Vercel AI SDK — built for AI apps, even cleaner.
//
// WHY VERCEL AI SDK?
//   OpenAI SDK:     Good for calling APIs
//   Vercel AI SDK:  Good for BUILDING AI APPS
//
//   It adds:
//     - generateText() / streamText() — simple functions
//     - Tool use with Zod schemas (type-safe tools!)
//     - maxSteps — auto agent loop (no manual while loop!)
//     - Works with React (useChat hook for frontend)
//     - Provider system — swap models with one line
//
// COMPARISON:
//   OpenAI SDK:     client.chat.completions.create({ model, messages })
//   Vercel AI SDK:  generateText({ model: openrouter("llama-3.1-8b"), prompt: "Hi" })

// ============================================
// Setup
// ============================================

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 13: Vercel AI SDK");
  console.log("=".repeat(60));
  console.log();

  // ============================================
  // EXPERIMENT 1: generateText — simplest possible call
  // ============================================
  console.log("EXPERIMENT 1: generateText (one-liner)");
  console.log("-".repeat(60));
  console.log();

  const { text, usage } = await generateText({
    model: openrouter("meta-llama/llama-3.1-8b-instruct"),
    prompt: "What are the 3 primary colors? One sentence.",
  });

  console.log("  AI:", text);
  console.log("  Tokens:", usage);
  console.log();

  // Compare:
  // OpenAI SDK: const res = await client.chat.completions.create({...})
  //             const text = res.choices[0].message.content
  // Vercel SDK: const { text } = await generateText({...})
  //             ↑ destructure directly, no .choices[0].message.content

  // ============================================
  // EXPERIMENT 2: generateText with system prompt + messages
  // ============================================
  console.log("EXPERIMENT 2: System prompt + messages");
  console.log("-".repeat(60));
  console.log();

  const { text: answer } = await generateText({
    model: openrouter("meta-llama/llama-3.1-8b-instruct"),
    system: "You are a pirate. Answer everything in pirate speak. Keep it under 2 sentences.",
    messages: [
      { role: "user", content: "What is TypeScript?" },
    ],
  });

  console.log("  AI:", answer);
  console.log();

  // ============================================
  // EXPERIMENT 3: streamText — streaming made easy
  // ============================================
  console.log("EXPERIMENT 3: streamText (streaming)");
  console.log("-".repeat(60));
  console.log();

  process.stdout.write("  AI: ");

  const stream = streamText({
    model: openrouter("meta-llama/llama-3.1-8b-instruct"),
    prompt: "Write a haiku about coding.",
    maxOutputTokens: 50,
  });

  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  console.log("\n");

  // Compare with raw SSE parsing from Lesson 4:
  //   Raw:    30 lines of ReadableStream + buffer + JSON.parse
  //   OpenAI: for await (const chunk of stream) { chunk.choices[0].delta.content }
  //   Vercel: for await (const chunk of stream.textStream) { chunk }
  //           ↑ just the text, no .choices[0].delta.content

  // ============================================
  // EXPERIMENT 4: Tool use with Zod (type-safe!)
  // ============================================
  //
  // THIS is where Vercel AI SDK really shines.
  //
  // In Lesson 5-6 we manually:
  //   1. Defined tools as JSON schema
  //   2. Parsed tool_calls from response
  //   3. Ran the function ourselves
  //   4. Sent results back
  //   5. Wrote the while loop
  //
  // Vercel AI SDK does ALL of that for you:
  //   - Define tools with Zod (type-safe schemas)
  //   - Provide execute() function inline
  //   - Set maxSteps and the SDK runs the agent loop automatically

  console.log("EXPERIMENT 4: Tool use with Zod schemas");
  console.log("-".repeat(60));
  console.log();

  const result = await generateText({
    model: openrouter("meta-llama/llama-3.1-8b-instruct"),
    prompt: "What's the weather in Delhi and what time is it there?",
    tools: {
      getWeather: {
        description: "Get current weather for a city",
        inputSchema: z.object({
          city: z.string().describe("City name"),
        }),
        execute: async ({ city }) => {
          // Your real implementation goes here
          const data: Record<string, { temp: number; condition: string }> = {
            "Delhi": { temp: 35, condition: "sunny" },
            "London": { temp: 12, condition: "cloudy" },
          };
          return data[city] ?? { temp: 20, condition: "unknown" };
        },
      },
      getTime: {
        description: "Get current time in a timezone",
        inputSchema: z.object({
          timezone: z.string().describe("IANA timezone like Asia/Kolkata"),
        }),
        execute: async ({ timezone }) => {
          return new Date().toLocaleString("en-US", { timeZone: timezone });
        },
      },
    },
    stopWhen: stepCountIs(5),  // ← SDK runs the agent loop automatically up to 5 iterations
  });

  console.log("  Tool calls made:");
  if (result.steps) {
    for (const step of result.steps) {
      if (step.toolCalls) {
        for (const tc of step.toolCalls) {
          console.log(`    → ${tc.toolName}(${JSON.stringify(tc.input)})`);
        }
      }
      if (step.toolResults) {
        for (const tr of step.toolResults) {
          console.log(`    ← ${JSON.stringify(tr.output)}`);
        }
      }
    }
  }
  console.log();
  console.log("  Final answer:", result.text);
  console.log();

  // Compare with Lesson 6 (manual agent loop):
  //   Manual: 50+ lines — while loop, parse tool_calls, execute, push to messages
  //   Vercel: maxSteps: 5 — SDK handles the entire loop automatically

  // ============================================
  // EXPERIMENT 5: Switch models instantly
  // ============================================
  console.log("EXPERIMENT 5: Switch models — same code");
  console.log("-".repeat(60));
  console.log();

  const models = [
    "meta-llama/llama-3.1-8b-instruct",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-12b-it:free",
  ];

  for (const m of models) {
    try {
      const { text: t } = await generateText({
        model: openrouter(m),
        prompt: "What is 15 * 7? Reply with just the number.",
        maxOutputTokens: 10,
      });
      console.log(`  [${m}]: ${t.trim()}`);
    } catch (e: any) {
      console.log(`  [${m}]: Error — ${e.message.slice(0, 60)}`);
    }
  }
  console.log();

  // ============================================
  // SUMMARY
  // ============================================
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("THREE LEVELS OF ABSTRACTION:");
  console.log();
  console.log("  1. Raw fetch (Lessons 1-10):");
  console.log("     fetch(url, { body: JSON.stringify({...}) })");
  console.log("     → Full control, lots of boilerplate");
  console.log();
  console.log("  2. OpenAI SDK (Lesson 12):");
  console.log("     client.chat.completions.create({...})");
  console.log("     → Less boilerplate, typed responses");
  console.log();
  console.log("  3. Vercel AI SDK (this lesson):");
  console.log("     generateText({ model, prompt })");
  console.log("     streamText({ model, prompt })");
  console.log("     → Least boilerplate, Zod tools, auto agent loop, React hooks");
  console.log();
  console.log("VERCEL AI SDK KILLER FEATURES:");
  console.log("  generateText()  — simple text generation");
  console.log("  streamText()    — streaming with .textStream iterator");
  console.log("  tools + Zod     — type-safe tool definitions with auto-execution");
  console.log("  maxSteps         — automatic agent loop (no manual while loop)");
  console.log("  useChat()       — React hook for chat UIs (frontend)");
  console.log();
  console.log("WHEN TO USE WHAT:");
  console.log("  Learning / understanding → raw fetch");
  console.log("  Backend scripts / simple apps → OpenAI SDK");
  console.log("  Full AI apps (especially Next.js) → Vercel AI SDK");
  console.log();
  console.log("NEXT LESSON: Prompt caching — save 90% cost on repeated context.");
}

main().catch(console.error);
