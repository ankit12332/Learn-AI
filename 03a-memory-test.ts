import "dotenv/config";

// ============================================
// TEST: Does the LLM remember without history?
// ============================================

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: Message }[];
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

async function chat(messages: Message[]): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct",
      messages,
      temperature: 0,
      max_tokens: 50,
    }),
  });
  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() ?? "(no response)";
}

async function main(): Promise<void> {

  // ============================================
  // TEST 1: WITHOUT history (two separate calls)
  // ============================================
  console.log("=".repeat(60));
  console.log("TEST 1: WITHOUT history (separate API calls)");
  console.log("=".repeat(60));
  console.log();

  // Call 1: Tell it your name
  const reply1 = await chat([
    { role: "user", content: "My name is Ankit" },
  ]);
  console.log("  Call 1 → You: My name is Ankit");
  console.log("  Call 1 → AI:", reply1);
  console.log();

  // Call 2: Ask your name — but send ONLY this message (no history)
  const reply2 = await chat([
    { role: "user", content: "What is my name?" },
  ]);
  console.log("  Call 2 → You: What is my name?");
  console.log("  Call 2 → AI:", reply2);
  console.log();
  console.log("  ↑ It does NOT know. Each call is independent.");

  // ============================================
  // TEST 2: WITH history (full conversation sent)
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("TEST 2: WITH history (send full conversation)");
  console.log("=".repeat(60));
  console.log();

  // Call 1: Tell it your name
  const replyA = await chat([
    { role: "user", content: "My name is Ankit" },
  ]);
  console.log("  Call 1 → You: My name is Ankit");
  console.log("  Call 1 → AI:", replyA);
  console.log();

  // Call 2: Ask your name — but this time send the FULL history
  const replyB = await chat([
    { role: "user", content: "My name is Ankit" },
    { role: "assistant", content: replyA },           // include AI's previous reply
    { role: "user", content: "What is my name?" },
  ]);
  console.log("  Call 2 → You: What is my name?");
  console.log("  Call 2 → AI:", replyB);
  console.log();
  console.log("  ↑ It KNOWS because we sent the previous messages.");

  console.log();
  console.log("=".repeat(60));
  console.log("PROOF: Memory = sending history. Nothing more.");
  console.log("=".repeat(60));
}

main().catch(console.error);
