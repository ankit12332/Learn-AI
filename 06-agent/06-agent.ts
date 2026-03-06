import "dotenv/config";

// ============================================
// LESSON 6: Building an AI Agent
// ============================================
//
// What is an agent? It's NOT magic. It's just:
//
//   while (task not done) {
//     1. Send messages to LLM
//     2. LLM decides: respond OR call a tool
//     3. If tool call → run it, add result to messages, go to step 1
//     4. If text response → done, return to user
//   }
//
// That's it. That's what ChatGPT, Claude Code, Cursor, and every
// "AI agent" does under the hood. A loop.
//
// The LLM is the "brain" that decides WHICH tool to use and WHEN.
// Your code is the "hands" that actually execute things.

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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

// ============================================
// STEP 1: Define the tools (the agent's capabilities)
// ============================================

const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Perform a math calculation. Supports +, -, *, /, pow, sqrt.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression, e.g. '(23 + 17) * 4'" },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description: "Search a product database by query. Returns matching products with prices.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query, e.g. 'laptop', 'headphones'" },
          max_price: { type: "number", description: "Maximum price filter (optional)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_cart",
      description: "Add a product to the shopping cart.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Name of the product to add" },
          quantity: { type: "number", description: "Quantity to add (default 1)" },
        },
        required: ["product_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_cart",
      description: "View the current shopping cart with all items and total.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

// ============================================
// STEP 2: Implement the actual functions
// ============================================

// Fake product database
const products = [
  { name: "MacBook Pro M3", price: 1999, category: "laptop" },
  { name: "ThinkPad X1 Carbon", price: 1299, category: "laptop" },
  { name: "Dell XPS 15", price: 1499, category: "laptop" },
  { name: "Sony WH-1000XM5", price: 349, category: "headphones" },
  { name: "AirPods Pro", price: 249, category: "headphones" },
  { name: "Logitech MX Master", price: 99, category: "mouse" },
  { name: "Samsung 4K Monitor", price: 450, category: "monitor" },
  { name: "Mechanical Keyboard", price: 150, category: "keyboard" },
];

// Shopping cart state
const cart: { name: string; price: number; quantity: number }[] = [];

function executeTool(name: string, args: Record<string, any>): string {
  switch (name) {
    case "calculator": {
      try {
        // Simple math eval (safe for this demo — don't use eval in production!)
        const sanitized = args.expression.replace(/[^0-9+\-*/().%\s]/g, "");
        const result = Function(`"use strict"; return (${sanitized})`)();
        return JSON.stringify({ expression: args.expression, result });
      } catch (e: any) {
        return JSON.stringify({ error: e.message });
      }
    }

    case "search_products": {
      const query = args.query.toLowerCase();
      let results = products.filter(
        p => p.name.toLowerCase().includes(query) || p.category.includes(query)
      );
      if (args.max_price) {
        results = results.filter(p => p.price <= args.max_price);
      }
      return JSON.stringify({ query: args.query, results, count: results.length });
    }

    case "add_to_cart": {
      const product = products.find(
        p => p.name.toLowerCase() === args.product_name.toLowerCase()
      );
      if (!product) return JSON.stringify({ error: `Product "${args.product_name}" not found` });

      const existing = cart.find(c => c.name === product.name);
      if (existing) {
        existing.quantity += args.quantity ?? 1;
      } else {
        cart.push({ name: product.name, price: product.price, quantity: args.quantity ?? 1 });
      }
      return JSON.stringify({ added: product.name, quantity: args.quantity ?? 1, cart_size: cart.length });
    }

    case "get_cart": {
      const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return JSON.stringify({ items: cart, total });
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ============================================
// STEP 3: The Agent Loop
// ============================================

async function runAgent(userMessage: string, maxIterations = 10): Promise<void> {
  console.log(`\nYou: ${userMessage}`);
  console.log("-".repeat(60));

  const messages: Message[] = [
    {
      role: "system",
      content: `You are a helpful shopping assistant. You can search products, do calculations, and manage a shopping cart. Use the tools available to help the user. When comparing options, search first, then help them decide.`,
    },
    { role: "user", content: userMessage },
  ];

  let iteration = 0;

  // THE AGENT LOOP — this is the core of every AI agent
  while (iteration < maxIterations) {
    iteration++;

    // Call the LLM
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: toolDefinitions,
        temperature: 0,
        max_tokens: 500,
      }),
    });

    const data = await response.json() as ChatCompletionResponse;
    if (data.error) { console.log("  Error:", data.error.message); break; }

    const choice = data.choices?.[0];
    if (!choice) { console.log("  No response"); break; }

    const aiMessage = choice.message;

    // Does the LLM want to call tools?
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      // Add the AI's tool call message to history
      messages.push(aiMessage);

      console.log(`  [Loop ${iteration}] LLM wants to call ${aiMessage.tool_calls.length} tool(s):`);

      for (const tc of aiMessage.tool_calls) {
        const args = JSON.parse(tc.function.arguments);
        console.log(`    → ${tc.function.name}(${JSON.stringify(args)})`);

        // Execute the tool
        const result = executeTool(tc.function.name, args);
        console.log(`    ← ${result}`);

        // Add tool result to messages
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // Continue the loop — LLM will see the tool results next
      continue;
    }

    // No tool calls — LLM is giving a final text response
    console.log(`  [Loop ${iteration}] LLM responds (no more tools needed):`);
    console.log();
    console.log(`  AI: ${aiMessage.content}`);
    console.log();
    console.log(`  Total iterations: ${iteration} | Messages in context: ${messages.length}`);
    break;
  }

  if (iteration >= maxIterations) {
    console.log("  Agent hit max iterations — stopped to prevent infinite loop.");
  }
}

// ============================================
// STEP 4: Run the agent with different tasks
// ============================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 6: AI Agent — Tool Use Loop in Action");
  console.log("=".repeat(60));
  console.log();
  console.log("Watch the agent decide which tools to use and in what order.");
  console.log("You'll see the loop: LLM thinks → calls tool → gets result → thinks again");

  // Task 1: Simple — requires one tool
  await runAgent("Show me headphones under $300");

  // Task 2: Multi-step — requires search + calculation
  await runAgent(
    "I want to buy 2 AirPods Pro and 1 Logitech MX Master. Add them to my cart and tell me the total."
  );

  // Task 3: Complex — agent must plan and use multiple tools
  await runAgent("What's in my cart now? And if I add a Samsung monitor, what would the new total be?");

  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("AN AGENT IS JUST A LOOP:");
  console.log("  while (not done) {");
  console.log("    response = LLM(messages + tools)");
  console.log("    if (response has tool_calls) → execute, add results, continue");
  console.log("    if (response has text) → return to user, break");
  console.log("  }");
  console.log();
  console.log("THE LLM DECIDES:");
  console.log("  - Which tool to call (or none)");
  console.log("  - What arguments to pass");
  console.log("  - When to stop and respond to the user");
  console.log();
  console.log("YOUR CODE DECIDES:");
  console.log("  - What tools exist");
  console.log("  - How tools actually work (the implementation)");
  console.log("  - Max iterations (safety limit)");
  console.log("  - What the system prompt says");
  console.log();
  console.log("THIS IS HOW EVERYTHING WORKS:");
  console.log("  - Claude Code: tools = read_file, edit_file, bash, grep");
  console.log("  - ChatGPT: tools = browser, code_interpreter, dall_e");
  console.log("  - Cursor: tools = read_file, edit_file, terminal");
  console.log("  - Your app: tools = whatever YOU define");
  console.log();
  console.log("NEXT LESSON: RAG (Retrieval Augmented Generation) —");
  console.log("give the LLM access to YOUR data using embeddings.");
}

main().catch(console.error);
