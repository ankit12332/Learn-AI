import "dotenv/config";

// ============================================
// LESSON 8: Multi-Model Routing
// ============================================
//
// Not all tasks need the same model.
//
// Using GPT-4o for "what's 2+2?" = burning money
// Using Llama-8B for "write a complex SQL query" = bad results
//
// Smart apps pick the RIGHT model for each task.
// OpenRouter makes this easy — same API, 200+ models.
//
// MENTAL MODEL:
//   Cheap/small model  → simple tasks (classification, extraction, routing)
//   Mid-tier model     → general tasks (chat, summarization, code)
//   Premium model      → hard tasks (complex reasoning, long docs, math)

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: Message }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: number };
  model?: string;
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

// ============================================
// Define our model tiers
// ============================================

const MODELS = {
  cheap: "meta-llama/llama-3.1-8b-instruct",      // ~$0.02/1M tokens — fast, good for simple tasks
  mid: "meta-llama/llama-3.3-70b-instruct",        // ~$0.30/1M tokens — strong general purpose
  premium: "anthropic/claude-sonnet-4",             // ~$3.00/1M tokens — best reasoning
} as const;

type ModelTier = keyof typeof MODELS;

async function chat(
  model: string,
  messages: Message[],
  maxTokens = 200
): Promise<{ content: string; model: string; promptTokens: number; completionTokens: number }> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens }),
  });

  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);

  return {
    content: data.choices?.[0]?.message?.content?.trim() ?? "(no response)",
    model: data.model ?? model,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ============================================
// EXPERIMENT 1: Same task, different models — compare quality + cost
// ============================================

async function experiment1(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 1: Same task across 3 model tiers");
  console.log("=".repeat(60));
  console.log();

  const tasks = [
    {
      name: "Simple classification",
      prompt: "Classify this as positive, negative, or neutral. Reply with ONE word only.\n\n\"The product arrived on time and works great!\"",
      note: "A cheap model handles this perfectly",
    },
    {
      name: "Code generation",
      prompt: "Write a TypeScript function that deep merges two objects. Handle arrays, nested objects, and null values. Only output the code.",
      note: "Mid-tier model is sufficient for most code tasks",
    },
    {
      name: "Complex reasoning",
      prompt: "A farmer has 3 wolves, 3 chickens, and a boat that carries at most 2 animals. Wolves eat chickens if wolves outnumber chickens on either side. Find the minimum crossings to get all animals across safely. Show your reasoning step by step.",
      note: "Premium model needed for multi-step logical reasoning",
    },
  ];

  for (const task of tasks) {
    console.log(`--- ${task.name} ---`);
    console.log(`Prompt: "${task.prompt.slice(0, 80)}..."`);
    console.log();

    for (const [tier, model] of Object.entries(MODELS)) {
      try {
        const result = await chat(model, [{ role: "user", content: task.prompt }], 300);
        const preview = result.content.slice(0, 120).replace(/\n/g, " ");
        console.log(`  [${tier.padEnd(7)}] ${preview}...`);
        console.log(`           tokens: ${result.promptTokens}+${result.completionTokens} | model: ${result.model}`);
      } catch (e: any) {
        console.log(`  [${tier.padEnd(7)}] Error: ${e.message}`);
      }
      console.log();
    }

    console.log(`  Takeaway: ${task.note}`);
    console.log();
  }
}

// ============================================
// EXPERIMENT 2: Build a smart router
// ============================================
//
// Use a CHEAP model to classify the task complexity,
// then route to the appropriate model tier.
// This is how production AI apps save money.

async function classifyComplexity(userMessage: string): Promise<ModelTier> {
  const result = await chat(
    MODELS.cheap,
    [
      {
        role: "system",
        content: `You are a task complexity classifier. Classify the user's request into exactly one category.

Reply with ONLY one word:
- "simple" — greetings, yes/no questions, classification, simple extraction
- "medium" — summarization, general questions, code generation, translation
- "complex" — multi-step reasoning, math proofs, research, long document analysis, debates

Reply with ONLY the single word: simple, medium, or complex`,
      },
      { role: "user", content: userMessage },
    ],
    10
  );

  const classification = result.content.toLowerCase().trim();
  if (classification.includes("complex")) return "premium";
  if (classification.includes("medium")) return "mid";
  return "cheap";
}

async function smartRouter(userMessage: string): Promise<void> {
  // Step 1: Classify (using cheap model)
  const tier = await classifyComplexity(userMessage);
  const model = MODELS[tier];

  console.log(`  Router: "${userMessage.slice(0, 50)}..."`);
  console.log(`  Classification: ${tier} → using ${model}`);

  // Step 2: Send to the right model
  const result = await chat(model, [{ role: "user", content: userMessage }], 200);
  console.log(`  Response: ${result.content.slice(0, 100).replace(/\n/g, " ")}...`);
  console.log(`  Tokens: ${result.promptTokens}+${result.completionTokens}`);
  console.log();
}

async function experiment2(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: Smart Router — auto-picks the model");
  console.log("=".repeat(60));
  console.log();
  console.log("A cheap model classifies the task, then we route to the right tier.");
  console.log();

  const requests = [
    "Hi, how are you?",                                            // simple → cheap
    "Summarize the key differences between REST and GraphQL",      // medium → mid
    "Prove that the square root of 2 is irrational step by step", // complex → premium
    "Is 7 a prime number?",                                        // simple → cheap
    "Write a React hook that handles infinite scroll with loading states and error handling", // medium → mid
  ];

  for (const req of requests) {
    await smartRouter(req);
  }
}

// ============================================
// EXPERIMENT 3: Fallback chain
// ============================================
//
// Try the cheap model first. If it fails or gives low quality,
// fall back to a better model. This saves money on easy tasks.

async function withFallback(
  messages: Message[],
  maxTokens = 200
): Promise<{ content: string; modelUsed: string; attempts: number }> {
  const chain: ModelTier[] = ["cheap", "mid", "premium"];

  for (let i = 0; i < chain.length; i++) {
    const tier = chain[i];
    const model = MODELS[tier];

    try {
      const result = await chat(model, messages, maxTokens);

      // Simple quality check: if response is too short or empty, try next model
      if (result.content.length < 10 && i < chain.length - 1) {
        console.log(`    [${tier}] Response too short, falling back...`);
        continue;
      }

      return { content: result.content, modelUsed: model, attempts: i + 1 };
    } catch (e: any) {
      console.log(`    [${tier}] Failed: ${e.message}, falling back...`);
      if (i === chain.length - 1) throw e;
    }
  }

  throw new Error("All models failed");
}

async function experiment3(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Fallback Chain");
  console.log("=".repeat(60));
  console.log();
  console.log("Try cheap model first → fall back to better models if needed.");
  console.log();

  const result = await withFallback([
    { role: "user", content: "Explain the difference between TCP and UDP in one sentence." }
  ]);

  console.log(`  Answer: ${result.content}`);
  console.log(`  Model used: ${result.modelUsed}`);
  console.log(`  Attempts: ${result.attempts}`);
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  await experiment1();
  await experiment2();
  await experiment3();

  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("MODEL TIERS:");
  console.log("  Cheap (8B params)   → classification, extraction, routing");
  console.log("  Mid (70B params)    → chat, code, summarization");
  console.log("  Premium (Claude/GPT)→ complex reasoning, long context");
  console.log();
  console.log("ROUTING STRATEGIES:");
  console.log("  1. Smart Router  — cheap model classifies → routes to right tier");
  console.log("  2. Fallback Chain — try cheap first → escalate if quality is low");
  console.log("  3. Task-based    — hardcode model per task type in your app");
  console.log();
  console.log("COST IMPACT:");
  console.log("  Without routing: every request hits premium model → expensive");
  console.log("  With routing: 80% of requests use cheap model → 10-50x savings");
  console.log();
  console.log("WHY OPENROUTER:");
  console.log("  Same API format for ALL models (OpenAI, Anthropic, Meta, Google)");
  console.log("  Switch models by changing one string. No SDK changes.");
  console.log("  Compare prices, speeds, and quality across 200+ models.");
  console.log();
  console.log("NEXT LESSON: Building a real chat UI with streaming —");
  console.log("putting everything together into a working app.");
}

main().catch(console.error);
