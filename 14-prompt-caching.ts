import "dotenv/config";

// ============================================
// LESSON 14: Prompt Caching
// ============================================
//
// PROBLEM: In real apps, you send the SAME context repeatedly.
//
//   Example — RAG chatbot:
//     Call 1: [system: 5000 tokens of docs] + [user: "What is refund policy?"]
//     Call 2: [system: 5000 tokens of docs] + [user: "How long is warranty?"]
//     Call 3: [system: 5000 tokens of docs] + [user: "Do you ship internationally?"]
//
//   You're paying for those 5000 tokens THREE times!
//
//   Example — long conversation:
//     Call 10: [system + 50 messages of history] + [user: "new question"]
//     Call 11: [system + 51 messages of history] + [user: "another question"]
//
//   99% of the input is the same. You're paying for it again.
//
// SOLUTION: Prompt Caching
//   The API remembers the beginning of your prompt.
//   If the next request starts the same way → CACHE HIT → 90% cheaper.
//
// WHO SUPPORTS IT:
//   - Anthropic (Claude): cache_control markers
//   - OpenAI: automatic caching (50% discount)
//   - Google (Gemini): context caching API
//   - OpenRouter: passes through provider caching

interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ContentPart {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface ChatCompletionResponse {
  choices?: { message: { content: string } }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

async function chat(
  model: string,
  messages: Message[],
  maxTokens = 100,
): Promise<{ content: string; usage: any }> {
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
    usage: data.usage ?? {},
  };
}

// ============================================
// Generate a large context (simulating company docs)
// ============================================

function generateLargeContext(): string {
  const sections = [
    "COMPANY OVERVIEW: TechStore India was founded in 2019 in Bangalore. We sell electronics, accessories, and software. We have 50 employees across 3 offices in Bangalore, Delhi, and Mumbai. Our mission is to provide the best tech products at affordable prices with excellent customer service.",
    "REFUND POLICY: Customers can request a full refund within 30 days of purchase for physical products. Digital products (software licenses, e-books, online courses) are non-refundable once the download or activation has been initiated. For defective products, we offer a full refund or replacement regardless of the time since purchase. Refund requests must be submitted via email to support@techstore.in with the order number and reason for return.",
    "SHIPPING POLICY: Standard shipping takes 5-7 business days for domestic orders. Express shipping (1-2 business days) costs an additional Rs 500. Free shipping is available on orders above Rs 5000. International shipping is available to 25 countries and takes 10-15 business days. All orders include tracking. We use BlueDart and Delhivery for domestic shipments.",
    "WARRANTY INFORMATION: All electronics come with a standard 1-year manufacturer warranty. Extended warranty (up to 3 years) can be purchased at 15% of the product price. Warranty covers manufacturing defects but not physical damage, water damage, or unauthorized modifications. Warranty claims require the original proof of purchase and the product must be sent to our service center in Bangalore.",
    "PAYMENT METHODS: We accept all major credit cards (Visa, Mastercard, Amex), debit cards, UPI (GPay, PhonePe, Paytm), net banking, and EMI options through major banks. Cash on delivery is available for orders under Rs 20000. Corporate bulk orders can be paid via bank transfer with NET 30 terms.",
    "TECHNICAL SUPPORT: Live chat support is available Monday through Saturday, 9 AM to 9 PM IST. Email support (support@techstore.in) has a response time of 24 hours. Phone support is available at +91-800-TECH-HELP (800-8324-4357). For enterprise customers, we offer dedicated account managers and 24/7 priority support.",
    "PRODUCT CATEGORIES: We carry over 5000 products across categories including Laptops, Desktops, Monitors, Keyboards, Mice, Headphones, Speakers, Storage Devices, Networking Equipment, Smart Home Devices, Mobile Accessories, and Software Licenses. We are authorized resellers for Apple, Samsung, Dell, HP, Lenovo, Logitech, Sony, and Microsoft.",
    "LOYALTY PROGRAM: TechStore Rewards members earn 1 point per Rs 100 spent. Points can be redeemed for discounts (100 points = Rs 50 off). Gold members (Rs 50000+ annual spend) get free express shipping, early access to sales, and 2x points. Platinum members (Rs 200000+ annual spend) get all Gold benefits plus a dedicated account manager and exclusive pricing.",
  ];

  return sections.join("\n\n");
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 14: Prompt Caching");
  console.log("=".repeat(60));
  console.log();

  const largeContext = generateLargeContext();
  const contextLength = largeContext.length;
  console.log(`Context size: ${contextLength} characters (~${Math.round(contextLength / 4)} tokens)`);
  console.log();

  // ============================================
  // EXPERIMENT 1: Without caching — pay full price every time
  // ============================================
  console.log("=".repeat(60));
  console.log("EXPERIMENT 1: Without caching (normal requests)");
  console.log("=".repeat(60));
  console.log();

  const model = "meta-llama/llama-3.1-8b-instruct";
  const questions = [
    "What is the refund policy for digital products?",
    "How much does express shipping cost?",
    "What payment methods do you accept?",
    "How do I contact technical support?",
    "What are the loyalty program tiers?",
  ];

  let totalPromptTokens = 0;
  let totalCachedTokens = 0;

  for (const q of questions) {
    const { content, usage } = await chat(model, [
      { role: "system", content: `You are a customer support agent for TechStore India. Answer using ONLY this context:\n\n${largeContext}` },
      { role: "user", content: q },
    ]);

    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    totalPromptTokens += usage.prompt_tokens ?? 0;
    totalCachedTokens += cached;

    console.log(`  Q: "${q}"`);
    console.log(`  A: ${content.slice(0, 80)}...`);
    console.log(`  Prompt tokens: ${usage.prompt_tokens} | Cached: ${cached}`);
    console.log();
  }

  console.log("-".repeat(60));
  console.log(`  Total prompt tokens: ${totalPromptTokens}`);
  console.log(`  Total cached tokens: ${totalCachedTokens}`);
  console.log();

  if (totalCachedTokens > 0) {
    console.log("  Cache HIT! The provider cached the repeated context.");
    console.log(`  Savings: ~${Math.round((totalCachedTokens / totalPromptTokens) * 100)}% of prompt tokens were cached.`);
  } else {
    console.log("  No caching detected with this model/provider.");
    console.log("  Some models cache automatically (OpenAI), some need explicit markers (Claude).");
  }

  // ============================================
  // EXPERIMENT 2: With explicit cache markers (Anthropic-style)
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: Explicit cache markers (Anthropic Claude)");
  console.log("=".repeat(60));
  console.log();

  // Anthropic's caching uses cache_control markers in content parts
  // This tells the API: "cache everything up to this point"
  const claudeModel = "anthropic/claude-3-haiku";  // cheapest Claude model

  console.log("  With Anthropic models, you mark WHERE to cache:");
  console.log();
  console.log('  content: [');
  console.log('    { type: "text", text: "<5000 tokens of docs>" },');
  console.log('    { type: "text", text: "<docs>",');
  console.log('      cache_control: { type: "ephemeral" }  ← CACHE THIS');
  console.log('    }');
  console.log('  ]');
  console.log();

  // Build message with cache_control
  const cachedMessages: Message[] = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: `You are a customer support agent for TechStore India. Answer using ONLY this context:\n\n${largeContext}`,
          cache_control: { type: "ephemeral" },  // ← Mark for caching
        },
      ],
    },
    { role: "user", content: "What is the refund policy for digital products?" },
  ];

  try {
    const { content, usage } = await chat(claudeModel, cachedMessages);
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    console.log(`  Q: "What is the refund policy for digital products?"`);
    console.log(`  A: ${content.slice(0, 100)}...`);
    console.log(`  Prompt tokens: ${usage.prompt_tokens} | Cached: ${cached}`);

    // Second call — should hit cache
    console.log();
    const cachedMessages2: Message[] = [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: `You are a customer support agent for TechStore India. Answer using ONLY this context:\n\n${largeContext}`,
            cache_control: { type: "ephemeral" },
          },
        ],
      },
      { role: "user", content: "How much does express shipping cost?" },
    ];

    const { content: content2, usage: usage2 } = await chat(claudeModel, cachedMessages2);
    const cached2 = usage2.prompt_tokens_details?.cached_tokens ?? 0;
    console.log(`  Q: "How much does express shipping cost?"`);
    console.log(`  A: ${content2.slice(0, 100)}...`);
    console.log(`  Prompt tokens: ${usage2.prompt_tokens} | Cached: ${cached2}`);
    console.log();

    if (cached2 > 0) {
      console.log(`  CACHE HIT! Second request reused ${cached2} cached tokens.`);
      console.log("  Cached tokens cost 90% less with Anthropic.");
    } else {
      console.log("  Cache may need a minimum size (1024+ tokens for Anthropic).");
    }
  } catch (e: any) {
    console.log(`  Skipped (${e.message.slice(0, 60)})`);
    console.log("  Note: This experiment requires an Anthropic-compatible model.");
  }

  // ============================================
  // EXPERIMENT 3: Show the math — how much caching saves
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Cost savings breakdown");
  console.log("=".repeat(60));
  console.log();

  const contextTokens = 1500;  // approximate for our context
  const questionTokens = 20;   // approximate per question
  const numQuestions = 100;     // simulate 100 questions per day

  // Without caching
  const totalInputWithout = (contextTokens + questionTokens) * numQuestions;

  // With caching (first call full price, rest cached at 10% cost)
  const firstCall = contextTokens + questionTokens;
  const cachedCalls = (contextTokens * 0.1 + questionTokens) * (numQuestions - 1);  // 90% discount on cached
  const totalInputWith = firstCall + cachedCalls;

  const costPerMToken = 3.0;  // Claude Sonnet input price
  const costWithout = (totalInputWithout / 1_000_000) * costPerMToken;
  const costWith = (totalInputWith / 1_000_000) * costPerMToken;
  const savings = ((costWithout - costWith) / costWithout * 100);

  console.log("  Scenario: RAG chatbot with 1500-token context, 100 questions/day");
  console.log();
  console.log("  WITHOUT CACHING:");
  console.log(`    ${numQuestions} calls × ${contextTokens + questionTokens} tokens = ${totalInputWithout.toLocaleString()} tokens`);
  console.log(`    Cost: $${costWithout.toFixed(4)}/day`);
  console.log();
  console.log("  WITH CACHING:");
  console.log(`    1st call: ${firstCall} tokens (full price)`);
  console.log(`    99 calls: ${contextTokens} cached tokens × 10% + ${questionTokens} new = ${Math.round(cachedCalls).toLocaleString()} tokens`);
  console.log(`    Total: ${Math.round(totalInputWith).toLocaleString()} tokens`);
  console.log(`    Cost: $${costWith.toFixed(4)}/day`);
  console.log();
  console.log(`  SAVINGS: ${savings.toFixed(0)}% cheaper!`);
  console.log();

  // Scale it up
  console.log("  AT SCALE (10,000 questions/day):");
  const scaledWithout = ((contextTokens + questionTokens) * 10000 / 1_000_000) * costPerMToken;
  const scaledWith = ((contextTokens + questionTokens) + (contextTokens * 0.1 + questionTokens) * 9999) / 1_000_000 * costPerMToken;
  console.log(`    Without caching: $${scaledWithout.toFixed(2)}/day`);
  console.log(`    With caching:    $${scaledWith.toFixed(2)}/day`);
  console.log(`    Savings:         $${(scaledWithout - scaledWith).toFixed(2)}/day = $${((scaledWithout - scaledWith) * 30).toFixed(0)}/month`);

  // ============================================
  // SUMMARY
  // ============================================
  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("WHAT IS PROMPT CACHING:");
  console.log("  The API remembers the START of your prompt.");
  console.log("  If the next request starts the same → cache hit → cheaper.");
  console.log();
  console.log("HOW IT WORKS PER PROVIDER:");
  console.log("  OpenAI:     Automatic. No code changes. 50% discount on cached.");
  console.log("  Anthropic:  Add cache_control markers. 90% discount on cached.");
  console.log("  Google:     Context Caching API. Separate endpoint.");
  console.log("  OpenRouter: Passes through provider caching automatically.");
  console.log();
  console.log("WHEN TO USE:");
  console.log("  - RAG: same context docs, different questions");
  console.log("  - Long conversations: growing history, same prefix");
  console.log("  - System prompts: same instructions for every request");
  console.log("  - Few-shot: same examples, different inputs");
  console.log();
  console.log("TIPS:");
  console.log("  - Put static content FIRST (system prompt, docs, examples)");
  console.log("  - Put dynamic content LAST (user question)");
  console.log("  - Cache works on PREFIX — same start = cache hit");
  console.log("  - Minimum size: Anthropic needs 1024+ tokens to cache");
  console.log();
  console.log("NEXT LESSON: Guardrails — prevent jailbreaks and validate outputs.");
}

main().catch(console.error);
