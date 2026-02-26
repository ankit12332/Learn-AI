import "dotenv/config";

// ============================================
// LESSON 7: RAG (Retrieval Augmented Generation)
// ============================================
//
// PROBLEM: The LLM doesn't know YOUR data.
//   Ask it about your company's refund policy? It has no idea.
//   Ask it about your internal docs? It can't access them.
//
// SOLUTION: RAG — find relevant data FIRST, then stuff it into the prompt.
//
// The flow:
//   1. User asks a question
//   2. YOUR CODE searches your data for relevant chunks
//   3. You inject those chunks into the prompt
//   4. LLM answers USING your data as context
//
// The LLM doesn't search anything. YOU search. YOU inject. LLM reads.
//
// HOW TO SEARCH? Two approaches:
//   A. Keyword search (simple, like ctrl+F)
//   B. Semantic search using EMBEDDINGS (powerful, understands meaning)
//
// WHAT ARE EMBEDDINGS?
//   Text → [0.021, -0.543, 0.891, ...] (a vector of ~1500 numbers)
//   Similar meanings → similar vectors
//   "dog" and "puppy" → vectors pointing in similar directions
//   "dog" and "javascript" → vectors pointing in different directions

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: Message }[];
  error?: { message: string; code: number };
}

interface EmbeddingResponse {
  data?: { embedding: number[] }[];
  error?: { message: string };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

const MODEL = "meta-llama/llama-3.1-8b-instruct";

async function chat(messages: Message[], maxTokens = 300): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0, max_tokens: maxTokens }),
  });
  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() ?? "(no response)";
}

// ============================================
// OUR "DATABASE" — imagine these are your company docs
// ============================================

const knowledgeBase = [
  {
    id: 1,
    title: "Refund Policy",
    content: "Customers can request a full refund within 30 days of purchase. After 30 days, only store credit is available. Digital products are non-refundable once downloaded. To request a refund, email support@store.com with your order number.",
  },
  {
    id: 2,
    title: "Shipping Information",
    content: "Standard shipping takes 5-7 business days. Express shipping takes 1-2 business days and costs $15 extra. International shipping is available to 50 countries and takes 10-15 business days. Free shipping on orders over $100.",
  },
  {
    id: 3,
    title: "Product Warranty",
    content: "All electronics come with a 1-year manufacturer warranty. Extended warranty (3 years) can be purchased for 15% of the product price. Warranty covers manufacturing defects but not physical damage. Warranty claims require proof of purchase.",
  },
  {
    id: 4,
    title: "Account & Privacy",
    content: "We store minimal personal data: name, email, and shipping address. You can delete your account anytime from Settings > Account > Delete. We never sell data to third parties. Two-factor authentication is available for all accounts.",
  },
  {
    id: 5,
    title: "Technical Support",
    content: "Live chat is available Monday to Friday, 9am to 6pm IST. Response time for email tickets is within 24 hours. For urgent issues, call our hotline: +91-800-123-4567. We offer free remote desktop support for setup issues.",
  },
];

// ============================================
// EXPERIMENT 1: Without RAG (LLM doesn't know your data)
// ============================================

async function withoutRAG(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 1: Without RAG — LLM has no context");
  console.log("=".repeat(60));
  console.log();

  const question = "What is your refund policy for digital products?";
  console.log(`  Question: "${question}"`);
  console.log();

  const answer = await chat([
    { role: "system", content: "You are a customer support agent for an online store." },
    { role: "user", content: question },
  ]);

  console.log(`  Answer: ${answer}`);
  console.log();
  console.log("  Problem: The LLM MADE UP a refund policy. It doesn't know YOUR actual policy.");
  console.log("  This is called HALLUCINATION — confidently stating wrong info.");
}

// ============================================
// EXPERIMENT 2: Simple keyword search RAG
// ============================================

function keywordSearch(query: string, topK = 2): typeof knowledgeBase {
  const queryWords = query.toLowerCase().split(/\s+/);

  const scored = knowledgeBase.map(doc => {
    const docText = (doc.title + " " + doc.content).toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (word.length < 3) continue;  // skip short words
      if (docText.includes(word)) score++;
    }
    return { ...doc, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

async function withKeywordRAG(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: With Keyword Search RAG");
  console.log("=".repeat(60));
  console.log();

  const question = "What is your refund policy for digital products?";
  console.log(`  Question: "${question}"`);
  console.log();

  // Step 1: Search our knowledge base
  const relevantDocs = keywordSearch(question);
  console.log("  Step 1 — Found relevant docs:");
  for (const doc of relevantDocs) {
    console.log(`    [${doc.title}] (score: ${(doc as any).score})`);
  }
  console.log();

  // Step 2: Inject into prompt
  const context = relevantDocs
    .map(doc => `--- ${doc.title} ---\n${doc.content}`)
    .join("\n\n");

  const answer = await chat([
    {
      role: "system",
      content: `You are a customer support agent. Answer questions ONLY using the provided context. If the context doesn't contain the answer, say "I don't have that information."

CONTEXT:
${context}`,
    },
    { role: "user", content: question },
  ]);

  console.log(`  Step 2 — Injected docs into system prompt`);
  console.log();
  console.log(`  Answer: ${answer}`);
  console.log();
  console.log("  Now the answer is based on YOUR actual data!");
}

// ============================================
// EXPERIMENT 3: Semantic Search with Embeddings
// ============================================
//
// Keyword search fails when the user uses different words.
// "Can I get my money back?" should match "Refund Policy"
// but has ZERO keyword overlap.
//
// Embeddings solve this by understanding MEANING, not just words.

async function getEmbedding(text: string): Promise<number[]> {
  // OpenRouter doesn't support embeddings directly,
  // so we'll simulate with a simple approach and explain the real thing.
  //
  // In production, you'd use:
  //   - OpenAI's text-embedding-3-small ($0.02 per 1M tokens)
  //   - Cohere's embed-v3
  //   - Or a local model like all-MiniLM-L6-v2 (free)

  // Simple simulation: convert text to a basic vector using character frequencies
  const vec = new Array(26).fill(0);
  const lower = text.toLowerCase();
  for (const char of lower) {
    const idx = char.charCodeAt(0) - 97;
    if (idx >= 0 && idx < 26) vec[idx]++;
  }
  // Normalize
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return magnitude > 0 ? vec.map(v => v / magnitude) : vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;  // vectors are already normalized
}

async function withSemanticRAG(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Semantic Search (Embeddings Concept)");
  console.log("=".repeat(60));
  console.log();

  // Pre-compute embeddings for all docs (in production, do this once and store)
  console.log("  Step 1 — Creating embeddings for knowledge base...");
  const docEmbeddings = await Promise.all(
    knowledgeBase.map(async doc => ({
      ...doc,
      embedding: await getEmbedding(doc.title + " " + doc.content),
    }))
  );

  // Test with a query that has NO keyword overlap with "Refund Policy"
  const question = "Can I get my money back?";
  console.log();
  console.log(`  Question: "${question}"`);
  console.log("  (Note: zero keyword overlap with 'Refund Policy'!)");
  console.log();

  // Step 2: Embed the query
  const queryEmbedding = await getEmbedding(question);

  // Step 3: Find most similar docs
  const scored = docEmbeddings
    .map(doc => ({
      ...doc,
      similarity: cosineSimilarity(queryEmbedding, doc.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  console.log("  Step 2 — Similarity scores:");
  for (const doc of scored) {
    const bar = "█".repeat(Math.round(doc.similarity * 20));
    console.log(`    ${doc.similarity.toFixed(3)} ${bar} ${doc.title}`);
  }
  console.log();

  // Step 4: Use top results in prompt
  const topDocs = scored.slice(0, 2);
  const context = topDocs
    .map(doc => `--- ${doc.title} ---\n${doc.content}`)
    .join("\n\n");

  const answer = await chat([
    {
      role: "system",
      content: `You are a customer support agent. Answer ONLY using the provided context.

CONTEXT:
${context}`,
    },
    { role: "user", content: question },
  ]);

  console.log(`  Answer: ${answer}`);
  console.log();
  console.log("  NOTE: Our simple char-frequency embedding is a demo.");
  console.log("  Real embeddings (OpenAI, Cohere) understand actual meaning.");
  console.log('  "Can I get my money back?" would score highest for "Refund Policy"');
  console.log("  because real embeddings understand semantic similarity.");
}

// ============================================
// EXPERIMENT 4: Show the full RAG pipeline
// ============================================

async function fullRAGPipeline(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("THE COMPLETE RAG PIPELINE:");
  console.log("=".repeat(60));
  console.log();
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │              ONE-TIME SETUP (Indexing)           │");
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log("  │  Your docs/data                                 │");
  console.log("  │       ↓                                         │");
  console.log("  │  Split into chunks (500-1000 tokens each)       │");
  console.log("  │       ↓                                         │");
  console.log("  │  Create embedding for each chunk                │");
  console.log("  │       ↓                                         │");
  console.log("  │  Store in vector database                       │");
  console.log("  │  (Pinecone, Chroma, Weaviate, pgvector)         │");
  console.log("  └─────────────────────────────────────────────────┘");
  console.log();
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log("  │              QUERY TIME (Every request)          │");
  console.log("  ├─────────────────────────────────────────────────┤");
  console.log("  │  User question                                  │");
  console.log("  │       ↓                                         │");
  console.log("  │  Create embedding of the question               │");
  console.log("  │       ↓                                         │");
  console.log("  │  Search vector DB for similar chunks            │");
  console.log("  │  (cosine similarity)                            │");
  console.log("  │       ↓                                         │");
  console.log("  │  Inject top 3-5 chunks into system prompt       │");
  console.log("  │       ↓                                         │");
  console.log("  │  LLM answers using YOUR data as context         │");
  console.log("  └─────────────────────────────────────────────────┘");
  console.log();

  // Demonstrate: same question, with and without context
  const question = "How long does the warranty last and can I extend it?";
  console.log(`  Demo: "${question}"`);
  console.log();

  // Without RAG
  const noContext = await chat([
    { role: "system", content: "You are a customer support agent for an online store." },
    { role: "user", content: question },
  ]);
  console.log("  Without RAG:", noContext.slice(0, 100) + "...");
  console.log("  (Might be correct by luck, but it's a GUESS)");
  console.log();

  // With RAG
  const relevantDoc = knowledgeBase.find(d => d.title === "Product Warranty")!;
  const withContext = await chat([
    {
      role: "system",
      content: `You are a customer support agent. Answer ONLY using this context:

${relevantDoc.content}`,
    },
    { role: "user", content: question },
  ]);
  console.log("  With RAG:   ", withContext.slice(0, 100) + "...");
  console.log("  (Based on YOUR actual warranty policy)");
}

async function main(): Promise<void> {
  await withoutRAG();
  await withKeywordRAG();
  await withSemanticRAG();
  await fullRAGPipeline();

  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("RAG = Search your data + Stuff it into the prompt");
  console.log("The LLM doesn't search. YOUR code searches. LLM just reads.");
  console.log();
  console.log("SEARCH METHODS:");
  console.log("  Keyword: Simple, fast, fails with different wording");
  console.log("  Semantic: Uses embeddings, understands meaning, more powerful");
  console.log();
  console.log("EMBEDDINGS:");
  console.log('  Text → [0.02, -0.54, 0.89, ...] (vector of numbers)');
  console.log("  Similar text → similar vectors → high cosine similarity");
  console.log("  Use: OpenAI text-embedding-3-small, Cohere, or local models");
  console.log();
  console.log("VECTOR DATABASES (where you store embeddings):");
  console.log("  Pinecone — managed, easy to start");
  console.log("  ChromaDB — open source, runs locally");
  console.log("  pgvector — PostgreSQL extension (great if you already use PG)");
  console.log("  Weaviate — open source, feature-rich");
  console.log();
  console.log("REAL-WORLD RAG APPS:");
  console.log("  - Customer support chatbot (your docs)");
  console.log("  - Code assistant (your codebase)");
  console.log("  - Legal research (case documents)");
  console.log("  - Internal knowledge base search");
  console.log();
  console.log("NEXT LESSON: Multi-model routing — when to use which model,");
  console.log("and why OpenRouter makes this easy.");
}

main().catch(console.error);
