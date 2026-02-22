import "dotenv/config";

// ============================================
// LESSON 2: How LLMs Generate Text
// ============================================
//
// KEY CONCEPT: An LLM is a "next token predictor"
//
// Given: "The capital of France is"
// The LLM calculates probabilities for EVERY possible next token:
//   "Paris"  → 92%
//   "the"    → 2%
//   "Lyon"   → 1%
//   "a"      → 0.5%
//   ...thousands more tokens with tiny probabilities
//
// Then it SAMPLES from this distribution.
// HOW it samples is controlled by: temperature, top_p, top_k
//
// Think of it like a weighted dice roll:
//   temperature = 0   → Always pick the highest probability (deterministic)
//   temperature = 0.7 → Mostly pick high-prob tokens, sometimes surprise
//   temperature = 1.5 → More random, creative, sometimes nonsensical

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: ChatMessage; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.log("Set your OPENROUTER_API_KEY in .env first!");
  process.exit(1);
}

async function complete(
  prompt: string,
  options: { temperature?: number; top_p?: number; max_tokens?: number } = {}
): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 1,
      top_p: options.top_p ?? 1,
      max_tokens: options.max_tokens ?? 50,
    }),
  });

  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "(no response)";
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 2: Temperature & Sampling");
  console.log("=".repeat(60));

  // ============================================
  // EXPERIMENT 1: Temperature = 0 (deterministic)
  // ============================================
  console.log();
  console.log("EXPERIMENT 1: Temperature = 0 (deterministic)");
  console.log("Same prompt, 3 times. Should give IDENTICAL answers.");
  console.log("-".repeat(60));

  const factualPrompt = "Complete this sentence in exactly 5 words: The capital of France is";

  for (let i = 1; i <= 3; i++) {
    const answer = await complete(factualPrompt, { temperature: 0, max_tokens: 20 });
    console.log(`  Run ${i}: ${answer.trim()}`);
  }

  // ============================================
  // EXPERIMENT 2: Temperature = 1.0 (default, balanced)
  // ============================================
  console.log();
  console.log("EXPERIMENT 2: Temperature = 1.0 (balanced randomness)");
  console.log("Same prompt, 3 times. Answers will VARY.");
  console.log("-".repeat(60));

  for (let i = 1; i <= 3; i++) {
    const answer = await complete(factualPrompt, { temperature: 1.0, max_tokens: 20 });
    console.log(`  Run ${i}: ${answer.trim()}`);
  }

  // ============================================
  // EXPERIMENT 3: Temperature = 1.8 (high randomness)
  // ============================================
  console.log();
  console.log("EXPERIMENT 3: Temperature = 1.8 (very random)");
  console.log("Same prompt, 3 times. Answers will be wild/creative.");
  console.log("-".repeat(60));

  for (let i = 1; i <= 3; i++) {
    const answer = await complete(factualPrompt, { temperature: 1.8, max_tokens: 20 });
    console.log(`  Run ${i}: ${answer.trim()}`);
  }

  // ============================================
  // EXPERIMENT 4: Creative task — where temperature shines
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 4: Creative writing at different temperatures");
  console.log("=".repeat(60));

  const creativePrompt = "Write one sentence about a robot who learns to paint.";

  const temps = [0, 0.5, 1.0, 1.5];
  for (const temp of temps) {
    const answer = await complete(creativePrompt, { temperature: temp, max_tokens: 60 });
    console.log();
    console.log(`  Temperature ${temp}:`);
    console.log(`  ${answer.trim()}`);
  }

  // ============================================
  // EXPERIMENT 5: top_p (nucleus sampling)
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 5: top_p (nucleus sampling)");
  console.log("=".repeat(60));
  console.log();
  console.log("top_p = 0.1 → Only consider tokens in the top 10% probability mass");
  console.log("top_p = 0.9 → Consider tokens in the top 90% probability mass");
  console.log("top_p = 1.0 → Consider ALL tokens (default)");
  console.log();
  console.log("It's like temperature but works differently:");
  console.log("  temperature → changes the SHAPE of the distribution");
  console.log("  top_p       → CUTS OFF the tail of the distribution");
  console.log();

  const topPPrompt = "List 3 unusual pizza toppings:";

  for (const topP of [0.1, 0.5, 0.95]) {
    const answer = await complete(topPPrompt, { temperature: 1, top_p: topP, max_tokens: 40 });
    console.log(`  top_p=${topP}: ${answer.trim()}`);
    console.log();
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("HOW TEXT GENERATION WORKS:");
  console.log("  1. LLM gets your prompt as tokens");
  console.log("  2. It predicts probability for EVERY possible next token");
  console.log("  3. It samples one token based on temperature/top_p");
  console.log("  4. That token gets appended to the input");
  console.log("  5. Repeat from step 2 until max_tokens or stop token");
  console.log();
  console.log("  This is called AUTOREGRESSIVE generation.");
  console.log("  The model generates ONE token at a time, left to right.");
  console.log();
  console.log("WHEN TO USE WHAT:");
  console.log("  temperature=0      → Factual answers, code, math, JSON");
  console.log("  temperature=0.3-0.7 → General chat, balanced responses");
  console.log("  temperature=0.8-1.2 → Creative writing, brainstorming");
  console.log("  temperature>1.5    → Experimental, often incoherent");
  console.log();
  console.log("  tip: Don't change temperature AND top_p together.");
  console.log("       Pick one. Most apps just use temperature.");
  console.log();
  console.log("NEXT LESSON: Prompt engineering — system prompts, few-shot,");
  console.log("and chain-of-thought. How to CONTROL what the LLM outputs.");
}

main().catch(console.error);
