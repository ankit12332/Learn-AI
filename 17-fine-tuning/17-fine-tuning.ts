import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

// ============================================
// LESSON 17: Fine-Tuning
// ============================================
//
// WHAT IS FINE-TUNING?
//   Take a pre-trained model (like Llama, GPT-4o-mini)
//   and train it further on YOUR specific data.
//
//   Pre-trained model:  knows everything (general)
//   Fine-tuned model:   knows everything + YOUR specialty
//
// ANALOGY:
//   Pre-trained = Medical school graduate (knows medicine in general)
//   Fine-tuned  = Cardiologist (specialized in hearts)
//
//   The cardiologist didn't forget general medicine.
//   They just got MUCH BETTER at heart-related tasks.
//
// WHEN TO FINE-TUNE vs NOT:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  PROBLEM                    │  SOLUTION                  │
//   ├──────────────────────────────────────────────────────────┤
//   │  Model doesn't know your    │  RAG (Lesson 7)            │
//   │  company data               │  Stuff docs into prompt    │
//   │                             │                            │
//   │  Model's tone/style is      │  FINE-TUNING               │
//   │  wrong for your brand       │  Train on your examples    │
//   │                             │                            │
//   │  Model can't do a specific  │  FINE-TUNING               │
//   │  task format consistently   │  Train on input→output     │
//   │                             │                            │
//   │  Model needs latest info    │  RAG (NOT fine-tuning)     │
//   │  (today's news, prices)     │  Fine-tuning = static      │
//   │                             │                            │
//   │  Model gives verbose        │  FINE-TUNING or            │
//   │  answers, you want concise  │  PROMPT ENGINEERING        │
//   │                             │                            │
//   │  Model hallucinates on      │  RAG + GUARDRAILS          │
//   │  your domain                │  (NOT fine-tuning alone)   │
//   └──────────────────────────────────────────────────────────┘
//
// THE FINE-TUNING PIPELINE:
//
//   1. PREPARE DATA     →  Create training examples (JSONL)
//   2. UPLOAD           →  Send data to the provider
//   3. TRAIN            →  Provider trains your custom model
//   4. USE              →  Call your custom model like any other
//
// PROVIDERS THAT SUPPORT FINE-TUNING:
//   - OpenAI:      GPT-4o-mini, GPT-4o (easiest to start)
//   - Together AI: Llama, Mistral (open-source models)
//   - Fireworks:   Llama, Mixtral
//   - Hugging Face: Any model (need your own GPU)
//   - Google:      Gemini (via Vertex AI)

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ============================================
// STEP 1: PREPARE TRAINING DATA
// ============================================
// This is 80% of the work. Good data = good model.
//
// FORMAT: JSONL (JSON Lines) — one example per line
// Each example = a conversation showing the IDEAL behavior
//
// The model learns: "When I see inputs like THIS, I should respond like THAT"

interface TrainingMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface TrainingExample {
  messages: TrainingMessage[];
}

function createTrainingData(): TrainingExample[] {
  // SCENARIO: Fine-tune a model to be a TechStore customer support agent
  // that responds in a specific style:
  //   - Always greets with "Namaste!"
  //   - Uses bullet points for policies
  //   - Ends with "Is there anything else I can help with?"
  //   - Keeps responses under 3 sentences for simple questions
  //   - Uses ₹ symbol for prices

  const examples: TrainingExample[] = [
    // Example 1: Refund question
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "What is your refund policy?" },
        { role: "assistant", content: "Namaste! Here's our refund policy:\n\n- Physical products: Full refund within 30 days of purchase\n- Digital products: Non-refundable once downloaded/activated\n- Defective items: Full refund or replacement anytime\n\nTo request a refund, email support@techstore.in with your order number. Is there anything else I can help with?" },
      ],
    },

    // Example 2: Shipping question
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "How long does shipping take?" },
        { role: "assistant", content: "Namaste! Here are our shipping options:\n\n- Standard: 5-7 business days (free above ₹5,000)\n- Express: 1-2 business days (₹500 extra)\n- International: 10-15 business days\n\nAll orders include tracking via BlueDart or Delhivery. Is there anything else I can help with?" },
      ],
    },

    // Example 3: Price question
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "How much is the MacBook Air M3?" },
        { role: "assistant", content: "Namaste! The MacBook Air M3 starts at ₹1,14,900 for the base model (8GB RAM, 256GB SSD). We also have the 16GB/512GB variant at ₹1,44,900. Free express shipping on both! Is there anything else I can help with?" },
      ],
    },

    // Example 4: Off-topic question (model should redirect)
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "What's the weather today?" },
        { role: "assistant", content: "Namaste! I'm only able to help with TechStore-related questions like products, orders, shipping, and returns. For weather info, I'd suggest checking a weather app. Is there anything TechStore-related I can help with?" },
      ],
    },

    // Example 5: Complaint handling
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "My order arrived damaged! This is unacceptable!" },
        { role: "assistant", content: "Namaste! I'm truly sorry about the damaged order — that's definitely not the experience we want for you. Here's what we'll do:\n\n- We'll arrange a free replacement or full refund immediately\n- A return pickup will be scheduled within 24 hours\n- You'll receive ₹500 store credit for the inconvenience\n\nPlease share your order number and I'll get this sorted right away. Is there anything else I can help with?" },
      ],
    },

    // Example 6: Multi-turn conversation
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "I want to buy a laptop for coding" },
        { role: "assistant", content: "Namaste! Great choice! For coding, I'd recommend:\n\n- Budget (₹45,000-60,000): Lenovo IdeaPad Slim 5 — Ryzen 5, 16GB RAM\n- Mid-range (₹80,000-1,00,000): Dell XPS 13 — i7, 16GB RAM, great keyboard\n- Premium (₹1,14,000+): MacBook Air M3 — best battery life, fast for dev work\n\nWhat's your budget range? Is there anything else I can help with?" },
        { role: "user", content: "I have around 80k budget" },
        { role: "assistant", content: "For ₹80,000, the Dell XPS 13 is your best bet for coding:\n\n- 13th Gen Intel i7 processor\n- 16GB DDR5 RAM\n- 512GB NVMe SSD\n- 13.4\" display with great color accuracy\n- Currently at ₹79,990 with free express shipping\n\nWant me to help you place the order? Is there anything else I can help with?" },
      ],
    },

    // Example 7: Warranty question
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "How does your warranty work?" },
        { role: "assistant", content: "Namaste! Here's how our warranty works:\n\n- All electronics: 1-year standard manufacturer warranty included\n- Extended warranty: Up to 3 years, costs 15% of product price\n- Covers: Manufacturing defects\n- Does NOT cover: Physical damage, water damage, unauthorized mods\n\nYou'll need the original proof of purchase for claims. Is there anything else I can help with?" },
      ],
    },

    // Example 8: Payment question
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "Can I pay with UPI?" },
        { role: "assistant", content: "Namaste! Yes, absolutely! We accept all major payment methods:\n\n- UPI: GPay, PhonePe, Paytm\n- Cards: Visa, Mastercard, Amex (credit & debit)\n- Net Banking: All major banks\n- EMI: Available through major banks\n- Cash on Delivery: For orders under ₹20,000\n\nIs there anything else I can help with?" },
      ],
    },

    // Example 9: Loyalty program
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "Tell me about rewards program" },
        { role: "assistant", content: "Namaste! Our TechStore Rewards program is great for regular customers:\n\n- Earn 1 point per ₹100 spent\n- 100 points = ₹50 discount\n- Gold (₹50,000+/year): Free express shipping + 2x points\n- Platinum (₹2,00,000+/year): Dedicated account manager + exclusive pricing\n\nYou can sign up for free at checkout! Is there anything else I can help with?" },
      ],
    },

    // Example 10: Hours/contact
    {
      messages: [
        { role: "system", content: "You are TechStore India's customer support assistant." },
        { role: "user", content: "What are your support hours?" },
        { role: "assistant", content: "Namaste! You can reach us through:\n\n- Live Chat: Mon-Sat, 9 AM - 9 PM IST\n- Email: support@techstore.in (24-hour response time)\n- Phone: +91-800-TECH-HELP (Mon-Sat, 9 AM - 9 PM IST)\n- Enterprise customers: 24/7 priority support\n\nIs there anything else I can help with?" },
      ],
    },
  ];

  return examples;
}

// ============================================
// STEP 2: VALIDATE TRAINING DATA
// ============================================
// Before uploading, check for common mistakes

function validateTrainingData(examples: TrainingExample[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (examples.length < 10) {
    errors.push(`Need at least 10 examples, got ${examples.length}. (OpenAI minimum is 10, recommended 50-100)`);
  }

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];

    // Must have messages array
    if (!ex.messages || ex.messages.length < 2) {
      errors.push(`Example ${i + 1}: needs at least 2 messages (user + assistant)`);
    }

    // Must end with assistant message
    const lastMsg = ex.messages[ex.messages.length - 1];
    if (lastMsg.role !== "assistant") {
      errors.push(`Example ${i + 1}: must end with assistant message`);
    }

    // Check for empty content
    for (const msg of ex.messages) {
      if (!msg.content || msg.content.trim() === "") {
        errors.push(`Example ${i + 1}: empty ${msg.role} message`);
      }
    }

    // Check token length (rough estimate: 1 token ≈ 4 chars)
    const totalChars = ex.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.round(totalChars / 4);
    if (estimatedTokens > 4096) {
      errors.push(`Example ${i + 1}: ~${estimatedTokens} tokens (max recommended: 4096)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// STEP 3: SAVE AS JSONL FILE
// ============================================
// JSONL = one JSON object per line (NOT a JSON array)

function saveAsJsonl(examples: TrainingExample[], filename: string): void {
  const lines = examples.map((ex) => JSON.stringify(ex));
  const content = lines.join("\n") + "\n";
  fs.writeFileSync(filename, content);
}

// ============================================
// STEP 4: COMPARE — Before vs After Fine-Tuning
// ============================================
// We'll show the SAME question answered by:
//   1. Base model (generic response)
//   2. What a fine-tuned model WOULD produce

interface ChatCompletionResponse {
  choices?: { message: { content: string } }[];
  error?: { message: string; code: number };
}

async function chat(messages: { role: string; content: string }[], maxTokens = 200): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-8b-instruct",
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() ?? "(no response)";
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 17: Fine-Tuning");
  console.log("=".repeat(60));
  console.log();

  // ============================================
  // EXPERIMENT 1: Create and validate training data
  // ============================================
  console.log("EXPERIMENT 1: Create training data");
  console.log("-".repeat(60));
  console.log();

  const trainingData = createTrainingData();
  console.log(`  Created ${trainingData.length} training examples`);
  console.log();

  // Show one example
  console.log("  Example training conversation:");
  const sample = trainingData[0];
  for (const msg of sample.messages) {
    const preview = msg.content.slice(0, 80);
    console.log(`    [${msg.role}]: ${preview}${msg.content.length > 80 ? "..." : ""}`);
  }
  console.log();

  // Validate
  const validation = validateTrainingData(trainingData);
  if (validation.valid) {
    console.log("  Validation: PASSED (all checks OK)");
  } else {
    console.log("  Validation ERRORS:");
    for (const err of validation.errors) {
      console.log(`    - ${err}`);
    }
  }
  console.log();

  // Save as JSONL
  const jsonlPath = path.join(process.cwd(), "17-fine-tuning", "training-data.jsonl");
  saveAsJsonl(trainingData, jsonlPath);
  console.log(`  Saved to: ${jsonlPath}`);
  console.log();

  // Show JSONL format
  console.log("  JSONL format (first 2 lines):");
  const lines = fs.readFileSync(jsonlPath, "utf-8").split("\n");
  console.log(`    Line 1: ${lines[0].slice(0, 80)}...`);
  console.log(`    Line 2: ${lines[1].slice(0, 80)}...`);
  console.log();

  // ============================================
  // EXPERIMENT 2: Base model vs fine-tuned behavior
  // ============================================
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: Base model vs what fine-tuning achieves");
  console.log("=".repeat(60));
  console.log();

  const testQuestions = [
    "What is your refund policy?",
    "My order is damaged!",
    "What's the weather today?",
  ];

  for (const q of testQuestions) {
    console.log(`  Question: "${q}"`);
    console.log();

    // Base model (generic system prompt)
    const baseResponse = await chat([
      { role: "system", content: "You are a customer support assistant for TechStore India." },
      { role: "user", content: q },
    ]);

    console.log("  BASE MODEL (before fine-tuning):");
    console.log(`    ${baseResponse.slice(0, 150)}...`);
    console.log();

    // What fine-tuned model would produce (from training data or similar)
    const matchingExample = trainingData.find((ex) =>
      ex.messages.some((m) => m.role === "user" && m.content.toLowerCase().includes(q.toLowerCase().slice(0, 15)))
    );

    if (matchingExample) {
      const ftResponse = matchingExample.messages.find((m) => m.role === "assistant")?.content ?? "";
      console.log("  FINE-TUNED MODEL (after training):");
      console.log(`    ${ftResponse.slice(0, 150)}...`);
    } else {
      console.log("  FINE-TUNED MODEL would follow the pattern:");
      console.log('    - Start with "Namaste!"');
      console.log("    - Use bullet points");
      console.log('    - End with "Is there anything else I can help with?"');
    }
    console.log();
    console.log("  " + "-".repeat(50));
    console.log();
  }

  // ============================================
  // EXPERIMENT 3: Cost & size analysis
  // ============================================
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Cost and size analysis");
  console.log("=".repeat(60));
  console.log();

  let totalChars = 0;
  let totalMessages = 0;
  for (const ex of trainingData) {
    totalMessages += ex.messages.length;
    for (const msg of ex.messages) {
      totalChars += msg.content.length;
    }
  }
  const estimatedTokens = Math.round(totalChars / 4);

  console.log("  TRAINING DATA STATS:");
  console.log(`    Examples:         ${trainingData.length}`);
  console.log(`    Total messages:   ${totalMessages}`);
  console.log(`    Total characters: ${totalChars.toLocaleString()}`);
  console.log(`    Estimated tokens: ~${estimatedTokens.toLocaleString()}`);
  console.log();

  console.log("  FINE-TUNING COSTS (approximate):");
  console.log();
  console.log("    OpenAI GPT-4o-mini:");
  console.log(`      Training: $0.003 / 1K tokens × ${estimatedTokens} tokens × 3 epochs`);
  console.log(`      = $${((0.003 / 1000) * estimatedTokens * 3).toFixed(4)}`);
  console.log("      Using the model: $0.0003 / 1K input (same as base)");
  console.log();
  console.log("    OpenAI GPT-4o:");
  console.log(`      Training: $0.025 / 1K tokens × ${estimatedTokens} tokens × 3 epochs`);
  console.log(`      = $${((0.025 / 1000) * estimatedTokens * 3).toFixed(4)}`);
  console.log();
  console.log("    Together AI (Llama 3.1 8B):");
  console.log("      Often FREE for small datasets on open-source models");
  console.log();

  // ============================================
  // EXPERIMENT 4: How to actually fine-tune
  // ============================================
  console.log("=".repeat(60));
  console.log("EXPERIMENT 4: How to fine-tune (step-by-step)");
  console.log("=".repeat(60));
  console.log();

  console.log("  OPTION A: OpenAI Fine-Tuning (easiest)");
  console.log("  ─────────────────────────────────────");
  console.log();
  console.log("  Step 1: Get an OpenAI API key from platform.openai.com");
  console.log();
  console.log("  Step 2: Upload training data:");
  console.log("    const file = await openai.files.create({");
  console.log('      file: fs.createReadStream("training-data.jsonl"),');
  console.log('      purpose: "fine-tune",');
  console.log("    });");
  console.log();
  console.log("  Step 3: Create fine-tuning job:");
  console.log("    const job = await openai.fineTuning.jobs.create({");
  console.log('      model: "gpt-4o-mini-2024-07-18",');
  console.log("      training_file: file.id,");
  console.log("      hyperparameters: { n_epochs: 3 },");
  console.log("    });");
  console.log();
  console.log("  Step 4: Wait (usually 10-30 minutes for small datasets)");
  console.log("    const status = await openai.fineTuning.jobs.retrieve(job.id);");
  console.log('    // status.status: "validating_files" → "running" → "succeeded"');
  console.log();
  console.log("  Step 5: Use your fine-tuned model:");
  console.log("    const response = await openai.chat.completions.create({");
  console.log('      model: "ft:gpt-4o-mini-2024-07-18:your-org::abc123",  // your custom model ID');
  console.log("      messages: [{ role: 'user', content: 'What is your refund policy?' }],");
  console.log("    });");
  console.log();

  console.log("  OPTION B: Together AI (open-source models)");
  console.log("  ───────────────────────────────────────────");
  console.log();
  console.log("  Step 1: Get API key from api.together.xyz");
  console.log("  Step 2: Upload JSONL file via their API or dashboard");
  console.log("  Step 3: Start fine-tuning job (Llama 3.1 8B, Mistral, etc.)");
  console.log("  Step 4: Deploy and use via their API");
  console.log("  Bonus: You OWN the weights — download and run locally with Ollama");
  console.log();

  console.log("  OPTION C: Hugging Face + Your GPU");
  console.log("  ─────────────────────────────────");
  console.log();
  console.log("  - Full control, but need a GPU (RTX 3090+ for 7B models)");
  console.log("  - Use LoRA/QLoRA to fine-tune with less VRAM:");
  console.log("    Full fine-tuning 7B model:  ~28 GB VRAM");
  console.log("    LoRA fine-tuning 7B model:  ~8 GB VRAM");
  console.log("    QLoRA fine-tuning 7B model: ~6 GB VRAM");
  console.log();

  // ============================================
  // SUMMARY
  // ============================================
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("WHAT FINE-TUNING IS:");
  console.log("  Take a pre-trained model and teach it YOUR style/format/behavior.");
  console.log("  It learns patterns from your examples, not facts from your docs.");
  console.log();
  console.log("WHEN TO FINE-TUNE:");
  console.log("  - Consistent output format/style (always start with 'Namaste!')");
  console.log("  - Domain-specific behavior (medical terms, legal language)");
  console.log("  - Reducing prompt size (behavior baked in, no long system prompt)");
  console.log("  - Cost optimization (shorter prompts = fewer tokens per call)");
  console.log();
  console.log("WHEN NOT TO FINE-TUNE:");
  console.log("  - Need latest/dynamic data → use RAG instead");
  console.log("  - Simple behavior change → try prompt engineering first");
  console.log("  - Don't have enough examples (<10, ideally 50-100+)");
  console.log();
  console.log("THE PIPELINE:");
  console.log("  1. Collect examples (ideal input → output pairs)");
  console.log("  2. Format as JSONL (one conversation per line)");
  console.log("  3. Upload to provider (OpenAI, Together AI, etc.)");
  console.log("  4. Train (10-30 min for small datasets)");
  console.log("  5. Use: same API, just change the model name");
  console.log();
  console.log("BEST PRACTICES:");
  console.log("  - Quality > quantity (10 perfect examples > 100 sloppy ones)");
  console.log("  - Be consistent in your examples (same style everywhere)");
  console.log("  - Include edge cases (off-topic, complaints, multi-turn)");
  console.log("  - Test before and after (use Lesson 10's eval framework!)");
  console.log("  - Start with GPT-4o-mini or Llama 8B (cheap to experiment)");
  console.log();
  console.log("COST REALITY:");
  console.log("  - OpenAI GPT-4o-mini fine-tuning: < $1 for 100 examples");
  console.log("  - Together AI (open-source): often free for small jobs");
  console.log("  - The REAL cost is preparing good training data (your time)");
  console.log();
  console.log("FILES CREATED:");
  console.log(`  - training-data.jsonl  →  ${trainingData.length} examples ready to upload`);
  console.log();
  console.log("NEXT: Embeddings + Vector DBs — build production RAG.");
}

main().catch(console.error);
