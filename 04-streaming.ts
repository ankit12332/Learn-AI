import "dotenv/config";

// ============================================
// LESSON 4: Streaming Responses
// ============================================
//
// Without streaming:
//   You wait 3-5 seconds... then get the FULL response at once.
//
// With streaming:
//   Tokens arrive one by one as the LLM generates them.
//   The user sees text appearing in real-time (like ChatGPT).
//
// HOW IT WORKS:
//   1. You add  stream: true  to your API request
//   2. Instead of one JSON response, you get a stream of chunks
//   3. Each chunk contains one or a few tokens
//   4. The format is Server-Sent Events (SSE): "data: {...}\n\n"
//   5. The stream ends with "data: [DONE]"
//
// WHY IT MATTERS:
//   - Much better UX (user sees progress immediately)
//   - Time-to-first-token is fast even for long responses
//   - Every chat UI you've ever used does this

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

const MODEL = "meta-llama/llama-3.1-8b-instruct";

// ============================================
// EXPERIMENT 1: Non-streaming (what we've been doing)
// ============================================

async function nonStreaming(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 1: Non-streaming (wait for full response)");
  console.log("=".repeat(60));
  console.log();

  const start = Date.now();
  console.log("Waiting...");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Explain how the internet works in 3 sentences." }],
      temperature: 0.7,
      max_tokens: 100,
      stream: false,  // default — wait for full response
    }),
  });

  const data = await response.json() as any;
  const elapsed = Date.now() - start;

  console.log(data.choices?.[0]?.message?.content?.trim());
  console.log();
  console.log(`Time: ${elapsed}ms (you saw NOTHING until just now)`);
}

// ============================================
// EXPERIMENT 2: Streaming (tokens arrive one by one)
// ============================================

async function streaming(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: Streaming (tokens appear in real-time)");
  console.log("=".repeat(60));
  console.log();

  const start = Date.now();
  let firstTokenTime = 0;
  let tokenCount = 0;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "Explain how the internet works in 3 sentences." }],
      temperature: 0.7,
      max_tokens: 100,
      stream: true,  // ← THIS is the only difference
    }),
  });

  // The response body is a ReadableStream of SSE chunks
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE format: each event is "data: {json}\n\n"
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";  // keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;

      const jsonStr = trimmed.slice(6);  // remove "data: " prefix
      if (jsonStr === "[DONE]") continue;  // stream finished

      try {
        const chunk = JSON.parse(jsonStr);
        const token = chunk.choices?.[0]?.delta?.content;

        if (token) {
          if (tokenCount === 0) {
            firstTokenTime = Date.now() - start;
          }
          tokenCount++;
          process.stdout.write(token);  // print without newline — tokens appear one by one
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  const totalTime = Date.now() - start;
  console.log();
  console.log();
  console.log(`Time to first token: ${firstTokenTime}ms`);
  console.log(`Total time: ${totalTime}ms`);
  console.log(`Tokens received: ${tokenCount}`);
  console.log(`You saw text appearing as it was generated!`);
}

// ============================================
// EXPERIMENT 3: Build a streaming helper (reusable)
// ============================================
//
// This is the pattern you'll use in real apps.

interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (fullText: string) => void;
}

async function streamChat(
  messages: { role: string; content: string }[],
  callbacks: StreamCallbacks
): Promise<void> {
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
      max_tokens: 150,
      stream: true,
    }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

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
        const token = chunk.choices?.[0]?.delta?.content;
        if (token) {
          fullText += token;
          callbacks.onToken(token);
        }
      } catch {}
    }
  }

  callbacks.onDone(fullText);
}

async function main(): Promise<void> {
  // Run both experiments
  await nonStreaming();
  await streaming();

  // Experiment 3: Use the reusable helper
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Reusable stream helper");
  console.log("=".repeat(60));
  console.log();

  await streamChat(
    [
      { role: "system", content: "You are a haiku poet. Respond only in haikus." },
      { role: "user", content: "Write about programming" },
    ],
    {
      onToken: (token) => process.stdout.write(token),
      onDone: (fullText) => {
        console.log();
        console.log();
        console.log(`Full response (${fullText.length} chars): saved for your app to use`);
      },
    }
  );

  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("1. Add  stream: true  to your request — that's it");
  console.log("2. Response comes as SSE chunks: 'data: {json}\\n\\n'");
  console.log("3. Each chunk has  delta.content  (not message.content)");
  console.log("4. Stream ends with  'data: [DONE]'");
  console.log("5. You accumulate tokens into the full response yourself");
  console.log();
  console.log("IN A WEB APP:");
  console.log("  Backend: stream from OpenRouter → forward SSE to frontend");
  console.log("  Frontend: EventSource or fetch + ReadableStream");
  console.log("  This is how every ChatGPT-like UI works.");
  console.log();
  console.log("NEXT LESSON: Structured output — getting JSON, function");
  console.log("calling, and tool use from the LLM reliably.");
}

main().catch(console.error);
