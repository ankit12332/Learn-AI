import "dotenv/config";
import OpenAI from "openai";

// ============================================
// LESSON 12: Using the OpenAI SDK
// ============================================
//
// We've been writing raw fetch calls this whole time.
// That's great for understanding what's happening.
// But in real apps, use the OpenAI SDK — it handles:
//   - Type safety
//   - Streaming helpers
//   - Retry logic
//   - Error handling
//   - Tool call parsing
//
// KEY INSIGHT: The OpenAI SDK works with OpenRouter (and any
// OpenAI-compatible API) by just changing the baseURL.
// Same SDK, different backend.

// ============================================
// Setup: Point the OpenAI SDK at OpenRouter
// ============================================

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = "meta-llama/llama-3.1-8b-instruct";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 12: OpenAI SDK with OpenRouter");
  console.log("=".repeat(60));
  console.log();

  // ============================================
  // EXPERIMENT 1: Basic chat completion
  // ============================================
  // Compare: 15 lines of fetch → 5 lines with SDK
  console.log("EXPERIMENT 1: Basic chat (SDK vs fetch)");
  console.log("-".repeat(60));
  console.log();

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: "You are a helpful assistant. Be concise." },
      { role: "user", content: "What are the 3 main programming paradigms?" },
    ],
    temperature: 0.7,
    max_tokens: 150,
  });

  console.log("  Response:", completion.choices[0].message.content);
  console.log("  Tokens:", completion.usage?.total_tokens);
  console.log("  Model:", completion.model);
  console.log();

  // ============================================
  // EXPERIMENT 2: Streaming with SDK
  // ============================================
  // The SDK gives you an async iterator — much cleaner than
  // parsing SSE chunks manually like we did in Lesson 4
  console.log("EXPERIMENT 2: Streaming (so much cleaner!)");
  console.log("-".repeat(60));
  console.log();

  process.stdout.write("  AI: ");

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "user", content: "Write a haiku about TypeScript." },
    ],
    stream: true,  // same flag as before
    max_tokens: 50,
  });

  // Instead of parsing SSE manually, just iterate!
  let fullText = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) {
      process.stdout.write(token);
      fullText += token;
    }
  }
  console.log("\n");
  console.log(`  Full text collected: "${fullText.trim()}"`);
  console.log();

  // Compare with Lesson 4:
  // BEFORE (raw fetch): 30+ lines of ReadableStream + SSE parsing
  // NOW (SDK): 5 lines with for-await loop

  // ============================================
  // EXPERIMENT 3: Tool use with SDK
  // ============================================
  console.log("EXPERIMENT 3: Tool use (typed and clean)");
  console.log("-".repeat(60));
  console.log();

  const tools: OpenAI.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
            unit: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["city"],
        },
      },
    },
  ];

  // Step 1: Send message with tools
  const toolResponse = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "user", content: "What's the weather in Mumbai?" },
    ],
    tools,
    temperature: 0,
  });

  const message = toolResponse.choices[0].message;

  if (message.tool_calls && message.tool_calls.length > 0) {
    console.log("  LLM wants to call tools:");

    for (const tc of message.tool_calls) {
      console.log(`    → ${tc.function.name}(${tc.function.arguments})`);

      // Step 2: Execute tool (fake implementation)
      const fakeResult = JSON.stringify({ city: "Mumbai", temp: 32, condition: "humid" });
      console.log(`    ← ${fakeResult}`);

      // Step 3: Send result back
      const finalResponse = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "user", content: "What's the weather in Mumbai?" },
          message,  // SDK types handle tool_calls automatically
          { role: "tool", tool_call_id: tc.id, content: fakeResult },
        ],
        tools,
      });

      console.log(`  AI: ${finalResponse.choices[0].message.content}`);
    }
  } else {
    console.log(`  AI: ${message.content}`);
  }
  console.log();

  // ============================================
  // EXPERIMENT 4: Multiple models, same SDK
  // ============================================
  console.log("EXPERIMENT 4: Switch models — just change the string");
  console.log("-".repeat(60));
  console.log();

  const models = [
    "meta-llama/llama-3.1-8b-instruct",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-12b-it:free",
  ];

  const question = "What is 15 * 7? Reply with just the number.";

  for (const m of models) {
    try {
      const res = await client.chat.completions.create({
        model: m,
        messages: [{ role: "user", content: question }],
        temperature: 0,
        max_tokens: 10,
      });
      console.log(`  [${m}]: ${res.choices[0].message.content?.trim()}`);
    } catch (e: any) {
      console.log(`  [${m}]: Error — ${e.message.slice(0, 60)}`);
    }
  }
  console.log();

  // ============================================
  // EXPERIMENT 5: Error handling built-in
  // ============================================
  console.log("EXPERIMENT 5: Error handling");
  console.log("-".repeat(60));
  console.log();

  try {
    await client.chat.completions.create({
      model: "non-existent/model-that-doesnt-exist",
      messages: [{ role: "user", content: "Hi" }],
    });
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      console.log(`  Caught API error:`);
      console.log(`    Status: ${error.status}`);
      console.log(`    Message: ${error.message.slice(0, 80)}`);
      console.log(`    Type: ${error.constructor.name}`);
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
  console.log("SETUP (works with OpenRouter, OpenAI, or any compatible API):");
  console.log('  const client = new OpenAI({');
  console.log('    baseURL: "https://openrouter.ai/api/v1",');
  console.log('    apiKey: process.env.OPENROUTER_API_KEY,');
  console.log('  });');
  console.log();
  console.log("WHY USE THE SDK:");
  console.log("  - Type safety: full TypeScript types for all params/responses");
  console.log("  - Streaming: for-await loop instead of manual SSE parsing");
  console.log("  - Tool calls: types handle tool_calls automatically");
  console.log("  - Errors: typed error classes (APIError, RateLimitError, etc)");
  console.log("  - Retries: automatic retries on transient errors");
  console.log();
  console.log("SAME SDK, DIFFERENT BACKENDS:");
  console.log('  OpenRouter: baseURL = "https://openrouter.ai/api/v1"');
  console.log('  OpenAI:     baseURL = "https://api.openai.com/v1" (default)');
  console.log('  Local:      baseURL = "http://localhost:11434/v1" (Ollama)');
  console.log('  Azure:      use AzureOpenAI client instead');
  console.log();
  console.log("NEXT LESSON: Vercel AI SDK — the best DX for building");
  console.log("AI-powered web apps with Next.js/React.");
}

main().catch(console.error);
