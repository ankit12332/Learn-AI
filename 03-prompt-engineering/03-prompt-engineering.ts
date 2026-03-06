import "dotenv/config";

// ============================================
// LESSON 3: Prompt Engineering
// ============================================
//
// You now know: tokens, temperature, how generation works.
// Now: how to CONTROL what the LLM outputs.
//
// Three key techniques:
//   1. System Prompts — set the LLM's behavior/personality
//   2. Few-Shot Examples — show it what you want by example
//   3. Chain-of-Thought — make it reason step by step

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: Message; finish_reason: string }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

const MODEL = "meta-llama/llama-3.1-8b-instruct";

async function chat(messages: Message[], maxTokens = 150): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() ?? "(no response)";
}

// Helper to add a delay between API calls to avoid rate limits
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {

  // ============================================
  // TECHNIQUE 1: System Prompts
  // ============================================
  //
  // The "system" role is a special instruction to the LLM.
  // It sets behavior, personality, rules, and constraints.
  // The user NEVER sees it — it's your backstage control panel.

  console.log("=".repeat(60));
  console.log("TECHNIQUE 1: System Prompts");
  console.log("=".repeat(60));
  console.log();
  console.log('Same question: "What is recursion?"');
  console.log("But different system prompts → totally different answers:");
  console.log();

  const question = "What is recursion?";

  // System prompt 1: Expert teacher
  const answer1 = await chat([
    { role: "system", content: "You are a computer science professor. Explain concepts clearly with examples. Keep answers under 2 sentences." },
    { role: "user", content: question },
  ]);
  console.log("  [Professor]:", answer1);
  console.log();

  await delay(500);

  // System prompt 2: 5-year-old explainer
  const answer2 = await chat([
    { role: "system", content: "You explain everything like you're talking to a 5-year-old. Use simple words and fun analogies. Keep answers under 2 sentences." },
    { role: "user", content: question },
  ]);
  console.log("  [Kid-friendly]:", answer2);
  console.log();

  await delay(500);

  // System prompt 3: Pirate
  const answer3 = await chat([
    { role: "system", content: "You are a pirate. You answer all questions in pirate speak. Keep answers under 2 sentences." },
    { role: "user", content: question },
  ]);
  console.log("  [Pirate]:", answer3);
  console.log();

  await delay(500);

  // ============================================
  // TECHNIQUE 2: Few-Shot Prompting
  // ============================================
  //
  // Instead of explaining what you want, SHOW the LLM examples.
  // You do this by putting fake user/assistant turns in the messages.
  //
  // Zero-shot: "Convert this to JSON"  (no examples)
  // Few-shot:  Show 2-3 examples, then ask for the real one

  console.log("=".repeat(60));
  console.log("TECHNIQUE 2: Few-Shot Prompting");
  console.log("=".repeat(60));
  console.log();

  // ZERO-SHOT: Just ask directly
  console.log("Zero-shot (no examples):");
  const zeroShot = await chat([
    { role: "system", content: "Extract product info as JSON." },
    { role: "user", content: "The Nike Air Max 90 costs $120 and comes in sizes 8-13" },
  ]);
  console.log("  ", zeroShot);
  console.log();

  await delay(500);

  // FEW-SHOT: Show examples first
  console.log("Few-shot (with examples):");
  const fewShot = await chat([
    { role: "system", content: "Extract product info as JSON." },
    // Example 1 (we provide both the user input AND the ideal response)
    { role: "user", content: "Adidas Ultraboost costs $180, available in sizes 7-12" },
    { role: "assistant", content: '{"name":"Adidas Ultraboost","price":180,"currency":"USD","sizes":{"min":7,"max":12}}' },
    // Example 2
    { role: "user", content: "Puma RS-X is priced at $110 in sizes 6-11" },
    { role: "assistant", content: '{"name":"Puma RS-X","price":110,"currency":"USD","sizes":{"min":6,"max":11}}' },
    // NOW the real request — the LLM follows the pattern
    { role: "user", content: "The Nike Air Max 90 costs $120 and comes in sizes 8-13" },
  ]);
  console.log("  ", fewShot);
  console.log();

  console.log("  Notice: Few-shot gives you CONSISTENT structure because");
  console.log("  the LLM copies the exact pattern from your examples.");
  console.log();

  await delay(500);

  // ============================================
  // TECHNIQUE 3: Chain-of-Thought (CoT)
  // ============================================
  //
  // LLMs are bad at reasoning in one step.
  // But if you make them "think out loud", they get much better.
  //
  // Why? Because each generated token becomes INPUT for the next.
  // So intermediate reasoning steps help the model reach the right answer.

  console.log("=".repeat(60));
  console.log("TECHNIQUE 3: Chain-of-Thought");
  console.log("=".repeat(60));
  console.log();

  const mathProblem = "A store has 23 apples. They buy 17 more. Then they sell 8. A customer returns 3. How many apples does the store have?";

  // Without CoT
  console.log("Without chain-of-thought:");
  const directAnswer = await chat([
    { role: "system", content: "Answer with just the number." },
    { role: "user", content: mathProblem },
  ], 10);
  console.log("  Answer:", directAnswer);
  console.log();

  await delay(500);

  // With CoT
  console.log("With chain-of-thought:");
  const cotAnswer = await chat([
    { role: "system", content: "Think step by step. Show your work, then give the final answer." },
    { role: "user", content: mathProblem },
  ], 200);
  console.log("  ", cotAnswer);
  console.log();

  await delay(500);

  // ============================================
  // BONUS: Multi-turn Conversation
  // ============================================
  //
  // Chat models remember context because YOU send the full history
  // every time. The model itself has NO memory between API calls.

  console.log("=".repeat(60));
  console.log("BONUS: How Multi-turn Chat Works");
  console.log("=".repeat(60));
  console.log();
  console.log("The model has NO memory. YOU manage the conversation.");
  console.log("Each API call sends the FULL message history:");
  console.log();

  // Simulating a multi-turn conversation
  const history: Message[] = [
    { role: "system", content: "You are a helpful assistant. Be brief." },
  ];

  const userMessages = [
    "My name is Ankit.",
    "What programming languages should I learn for AI?",
    "What's my name?",  // Can it remember? Only if we sent the full history!
  ];

  for (const userMsg of userMessages) {
    history.push({ role: "user", content: userMsg });

    console.log(`  You: ${userMsg}`);
    const reply = await chat(history, 100);
    console.log(`  AI:  ${reply}`);
    console.log();

    // Add AI's response to history — this is how "memory" works
    history.push({ role: "assistant", content: reply });
    await delay(500);
  }

  console.log("  The AI remembered your name because we sent ALL previous");
  console.log("  messages in every request. That's the ONLY way chat works.");
  console.log();
  console.log(`  Messages sent in last call: ${history.length}`);
  console.log("  This is why long conversations use more tokens (= more cost).");

  // ============================================
  // SUMMARY
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("1. SYSTEM PROMPT: Controls personality, rules, output format");
  console.log("   → Use it in every request. It's your primary control lever.");
  console.log();
  console.log("2. FEW-SHOT: Show examples as fake user/assistant turns");
  console.log("   → Best for consistent structured output (JSON, tables, etc.)");
  console.log();
  console.log("3. CHAIN-OF-THOUGHT: Ask the model to think step by step");
  console.log("   → Dramatically improves reasoning/math/logic tasks");
  console.log();
  console.log("4. MULTI-TURN: Model has NO memory. You send full history.");
  console.log("   → Every message in history costs tokens on every call");
  console.log();
  console.log("NEXT LESSON: Streaming — watch the LLM generate tokens");
  console.log("in real-time, just like ChatGPT does.");
}

main().catch(console.error);
