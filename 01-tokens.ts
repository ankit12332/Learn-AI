import "dotenv/config";

// ============================================
// LESSON 1: Understanding Tokens
// ============================================
//
// KEY CONCEPT: LLMs don't see text. They see numbers (token IDs).
//
// The process:  Text → Tokenizer → [token IDs] → LLM → [token IDs] → Text
//
// Think of it like this:
// - You write: "Hello, how are you?"
// - The tokenizer converts it to: [9906, 11, 1268, 527, 499, 30]
// - The LLM processes these numbers and outputs new numbers
// - Those numbers get converted back to text
//
// WHY THIS MATTERS:
// - You're charged per token (not per word or character)
// - Context windows are measured in tokens (not words)
// - Some words = 1 token, some = multiple tokens
// - This affects cost, speed, and what fits in a single request

// ============================================
// EXPERIMENT 1: Manual tokenization visualization
// ============================================

// Let's see how different texts break into tokens.
// We'll use OpenRouter's API to count tokens for us.
// But first, let's understand the RULES of tokenization:

const examples: string[] = [
  // Common English words are usually 1 token
  "hello",          // 1 token
  "the",            // 1 token

  // Longer/rarer words get split into sub-words
  "tokenization",   // "token" + "ization" = 2-3 tokens
  "strawberry",     // "str" + "aw" + "berry" = 3 tokens (this is why LLMs miscount letters!)

  // Numbers are tricky
  "42",             // 1 token
  "123456789",      // Multiple tokens (numbers get split into chunks)

  // Spaces and punctuation
  "Hello, world!",  // "Hello" + "," + " world" + "!" = 4 tokens (note: space is part of "world")

  // Code
  "function hello() { return 'hi'; }",  // More tokens than you'd think

  // Non-English text uses MORE tokens (important for cost!)
  "こんにちは",       // Each character might be 1-3 tokens
  "Bonjour",        // 1-2 tokens
];

// ============================================
// EXPERIMENT 2: Token counting via OpenRouter
// ============================================

// Let's actually call an LLM and see token usage in the response

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: { message: ChatMessage; finish_reason: string }[];
  usage?: TokenUsage;
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.log("Set your OPENROUTER_API_KEY in .env first!");
  process.exit(1);
}

async function countTokens(text: string): Promise<ChatCompletionResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-nano-30b-a3b:free",
      messages: [
        { role: "user", content: text }
      ],
      max_tokens: 1,  // We only want 1 token back (we care about the INPUT token count)
    }),
  });

  return response.json() as Promise<ChatCompletionResponse>;
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 1: Understanding Tokens");
  console.log("=".repeat(60));
  console.log();

  // First, let's see what a raw API response looks like
  console.log("Making our FIRST API call...");
  console.log();

  const result = await countTokens("Hello, how are you?");

  console.log("Full API Response:");
  console.log(JSON.stringify(result, null, 2));
  console.log();

  console.log("=".repeat(60));
  console.log("Let's break down what we got back:");
  console.log("=".repeat(60));
  console.log();

  if (result.usage) {
    console.log(`Input text:     "Hello, how are you?"`);
    console.log(`Prompt tokens:   ${result.usage.prompt_tokens} (what WE sent)`);
    console.log(`Output tokens:   ${result.usage.completion_tokens} (what the LLM generated)`);
    console.log(`Total tokens:    ${result.usage.total_tokens}`);
    console.log();
    console.log("KEY INSIGHT: You pay for BOTH input AND output tokens.");
    console.log("Input tokens are usually cheaper than output tokens.");
  } else if (result.error) {
    console.log(`API Error: ${result.error.message}`);
    process.exit(1);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Now let's compare token counts for different inputs:");
  console.log("=".repeat(60));
  console.log();

  const testCases: string[] = [
    "Hi",
    "Hello, how are you doing today?",
    "Explain quantum computing in simple terms",
    "function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }",
    "The quick brown fox jumps over the lazy dog. ".repeat(10),
  ];

  for (const text of testCases) {
    const res = await countTokens(text);
    const displayText = text.length > 60 ? text.substring(0, 60) + "..." : text;
    const charCount = text.length;
    const promptTokens = res.usage?.prompt_tokens ?? 0;

    console.log(`Text: "${displayText}"`);
    console.log(`  Characters: ${charCount} | Tokens: ${promptTokens} | Ratio: ~${(charCount / promptTokens).toFixed(1)} chars/token`);
    console.log();
  }

  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("1. English text averages ~4 characters per token");
  console.log("2. Code tends to use MORE tokens per character");
  console.log("3. Common words = fewer tokens, rare words = more tokens");
  console.log("4. You pay for input + output tokens separately");
  console.log("5. Context window (e.g., 128K tokens) = how much text fits in one request");
  console.log();
  console.log("COST EXAMPLE:");
  console.log("  GPT-4o: ~$2.50 per 1M input tokens, ~$10 per 1M output tokens");
  console.log("  Claude Sonnet: ~$3 per 1M input tokens, ~$15 per 1M output tokens");
  console.log("  Llama 3.1 8B: Often free or <$0.10 per 1M tokens");
  console.log();
  console.log("  1M tokens ~ 750,000 words ~ about 10 novels");
  console.log();
  console.log("NEXT LESSON: We'll explore temperature, top_p, and how");
  console.log("the LLM actually GENERATES text (probability distributions).");
}

main().catch(console.error);
