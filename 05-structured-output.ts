import "dotenv/config";

// ============================================
// LESSON 5: Structured Output & Tool Use
// ============================================
//
// PROBLEM: LLMs return text. Your app needs data.
//
//   Bad:  "The weather in Delhi is 35 degrees celsius and sunny"
//   Good: { "city": "Delhi", "temp": 35, "unit": "celsius", "condition": "sunny" }
//
// Three techniques to get structured data:
//   1. Prompt-based JSON — just ask for JSON (fragile)
//   2. JSON Mode — API enforces valid JSON (better)
//   3. Tool Use / Function Calling — most reliable, most powerful

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices?: { message: Message; finish_reason: string }[];
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

const MODEL = "meta-llama/llama-3.1-8b-instruct";

async function chat(messages: Message[], options: any = {}): Promise<ChatCompletionResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0,
      max_tokens: 300,
      ...options,
    }),
  });
  return response.json() as Promise<ChatCompletionResponse>;
}

async function main(): Promise<void> {

  // ============================================
  // TECHNIQUE 1: Prompt-based JSON (fragile)
  // ============================================
  console.log("=".repeat(60));
  console.log("TECHNIQUE 1: Ask for JSON in the prompt");
  console.log("=".repeat(60));
  console.log();

  const res1 = await chat([
    {
      role: "system",
      content: "You extract product info. Always respond with ONLY valid JSON, no other text. Format: {\"name\": string, \"price\": number, \"currency\": string}",
    },
    {
      role: "user",
      content: "The MacBook Pro M3 costs $1999",
    },
  ]);

  const text1 = res1.choices?.[0]?.message?.content ?? "";
  console.log("  Raw response:", text1);

  // Try parsing it
  try {
    const parsed = JSON.parse(text1);
    console.log("  Parsed:", parsed);
    console.log("  Status: Worked this time!");
  } catch {
    console.log("  Status: FAILED to parse — this is the problem.");
    console.log("  The LLM might add 'Here is the JSON:' or markdown ```json blocks");
  }
  console.log();
  console.log("  Problem: Sometimes the LLM wraps JSON in text or markdown.");
  console.log("  You can't trust it 100%. That's why we need better methods.");

  // ============================================
  // TECHNIQUE 2: JSON Mode (API-enforced)
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("TECHNIQUE 2: JSON Mode (API enforces valid JSON)");
  console.log("=".repeat(60));
  console.log();

  const res2 = await chat(
    [
      {
        role: "system",
        content: `Extract product info. Respond as JSON with this schema:
{"name": string, "price": number, "currency": string, "category": string}`,
      },
      {
        role: "user",
        content: "Sony WH-1000XM5 headphones for 349 euros",
      },
    ],
    {
      response_format: { type: "json_object" },  // ← forces valid JSON output
    }
  );

  const text2 = res2.choices?.[0]?.message?.content ?? "";
  console.log("  Raw response:", text2);

  try {
    const parsed = JSON.parse(text2);
    console.log("  Parsed:", parsed);
    console.log("  Status: Guaranteed valid JSON!");
  } catch {
    console.log("  Status: Failed (some models don't support json_object mode)");
  }
  console.log();
  console.log("  Better! The API guarantees valid JSON.");
  console.log("  But you still can't control the exact SCHEMA reliably.");

  // ============================================
  // TECHNIQUE 3: Tool Use / Function Calling
  // ============================================
  //
  // THIS IS THE BIG ONE. This is how AI agents work.
  //
  // You define "tools" (functions) the LLM can call.
  // The LLM doesn't actually execute them — it returns
  // a structured request saying "call this function with these args".
  // YOUR CODE executes the function and sends the result back.
  //
  // Flow:
  //   1. You define tools with names, descriptions, and parameter schemas
  //   2. LLM sees the tools and decides if/which one to call
  //   3. LLM returns: { tool_calls: [{ function: { name, arguments } }] }
  //   4. YOUR code runs the actual function
  //   5. You send the result back to the LLM
  //   6. LLM uses the result to form a final answer

  console.log();
  console.log("=".repeat(60));
  console.log("TECHNIQUE 3: Tool Use / Function Calling");
  console.log("=".repeat(60));
  console.log();
  console.log("This is how AI agents work. The LLM can 'call' your functions.");
  console.log();

  // Define a tool — the LLM will see this definition
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "get_weather",
        description: "Get the current weather for a city",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "The city name, e.g. 'Delhi', 'London'",
            },
            unit: {
              type: "string",
              enum: ["celsius", "fahrenheit"],
              description: "Temperature unit",
            },
          },
          required: ["city"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_time",
        description: "Get the current time in a timezone",
        parameters: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description: "The timezone, e.g. 'Asia/Kolkata', 'America/New_York'",
            },
          },
          required: ["timezone"],
        },
      },
    },
  ];

  // Our actual function implementations
  function getWeather(city: string, unit = "celsius"): string {
    // In a real app, you'd call a weather API here
    const fakeData: Record<string, { temp: number; condition: string }> = {
      "Delhi": { temp: 35, condition: "sunny" },
      "London": { temp: 12, condition: "cloudy" },
      "Tokyo": { temp: 22, condition: "partly cloudy" },
    };
    const data = fakeData[city] ?? { temp: 20, condition: "unknown" };
    return JSON.stringify({ city, temperature: data.temp, unit, condition: data.condition });
  }

  function getTime(timezone: string): string {
    const time = new Date().toLocaleString("en-US", { timeZone: timezone });
    return JSON.stringify({ timezone, time });
  }

  // Step 1: Send the user's message WITH tool definitions
  console.log("  Step 1: User asks a question. LLM sees available tools.");
  console.log('  User: "What\'s the weather in Delhi and what time is it there?"');
  console.log();

  const res3 = await chat(
    [
      { role: "system", content: "You are a helpful assistant. Use tools when needed." },
      { role: "user", content: "What's the weather in Delhi and what time is it there?" },
    ],
    { tools }
  );

  const aiMessage = res3.choices?.[0]?.message;
  const toolCalls = aiMessage?.tool_calls;

  if (toolCalls && toolCalls.length > 0) {
    console.log("  Step 2: LLM decided to call these tools:");
    for (const tc of toolCalls) {
      console.log(`    → ${tc.function.name}(${tc.function.arguments})`);
    }
    console.log();
    console.log("  The LLM did NOT execute these. It just told us what to call.");
    console.log("  OUR code runs the actual functions now:");
    console.log();

    // Step 3: Execute each tool call
    const messages: Message[] = [
      { role: "system", content: "You are a helpful assistant. Use tools when needed." },
      { role: "user", content: "What's the weather in Delhi and what time is it there?" },
      aiMessage as Message,  // include the AI's tool_calls message
    ];

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments);
      let result: string;

      if (tc.function.name === "get_weather") {
        result = getWeather(args.city, args.unit);
      } else if (tc.function.name === "get_time") {
        result = getTime(args.timezone);
      } else {
        result = JSON.stringify({ error: "Unknown function" });
      }

      console.log(`  Step 3: ${tc.function.name} returned: ${result}`);

      // Send the tool result back to the LLM
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }

    // Step 4: LLM uses tool results to form final answer
    console.log();
    console.log("  Step 4: Send results back. LLM forms a human-readable answer:");
    console.log();

    const finalRes = await chat(messages);
    const finalAnswer = finalRes.choices?.[0]?.message?.content ?? "(no response)";
    console.log(`  AI: ${finalAnswer}`);
  } else {
    console.log("  LLM chose not to use tools. Response:");
    console.log(`  ${aiMessage?.content}`);
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("THREE WAYS TO GET STRUCTURED OUTPUT:");
  console.log();
  console.log("1. Prompt-based: 'Respond in JSON'");
  console.log("   → Simple but fragile. LLM might wrap in markdown or add text.");
  console.log();
  console.log("2. JSON Mode: response_format: { type: 'json_object' }");
  console.log("   → Guarantees valid JSON. Can't enforce exact schema.");
  console.log();
  console.log("3. Tool Use / Function Calling:");
  console.log("   → Most powerful. LLM returns structured function calls.");
  console.log("   → YOU execute the function and send results back.");
  console.log("   → This is how ChatGPT plugins, AI agents, and");
  console.log("     coding assistants (like Cursor, Claude Code) work.");
  console.log();
  console.log("THE TOOL USE LOOP:");
  console.log("  User message → LLM picks tool → You run it → Send result → LLM answers");
  console.log("  This loop can repeat multiple times (agent behavior).");
  console.log();
  console.log("NEXT LESSON: Building a simple AI agent that can use");
  console.log("multiple tools in a loop to solve tasks autonomously.");
}

main().catch(console.error);
