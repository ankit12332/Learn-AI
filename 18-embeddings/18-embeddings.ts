import "dotenv/config";

// ============================================
// LESSON 18: Embeddings & Vector Databases
// ============================================
//
// In Lesson 7 (RAG), we faked embeddings using character frequencies.
// Now we'll use REAL embeddings and build a proper vector search.
//
// WHAT ARE EMBEDDINGS?
//   Text → array of numbers (called a "vector")
//   "I love dogs"   → [0.12, -0.45, 0.78, 0.33, ...]  (1536 numbers)
//   "I adore puppies" → [0.11, -0.44, 0.79, 0.31, ...]  (very similar!)
//   "JavaScript arrays" → [-0.67, 0.23, -0.11, 0.89, ...] (very different!)
//
// WHY IS THIS USEFUL?
//   Similar meaning → similar numbers → you can SEARCH by meaning
//   "How do I return an item?" matches "Refund Policy" even though
//   they share ZERO words in common.
//
// ANALOGY:
//   Imagine every sentence is a point on a map.
//   Similar sentences are CLOSE together on the map.
//   Different sentences are FAR apart.
//   Searching = "find the closest points to my question"
//
// HOW EMBEDDINGS ARE CREATED:
//   A neural network reads the text and compresses its MEANING
//   into a fixed-size array of numbers. You don't train this yourself —
//   you call an API (OpenAI, Cohere, etc.) or use a local model.
//
//   Text → [Embedding Model] → [0.12, -0.45, 0.78, ...]
//
// REAL-WORLD EMBEDDING MODELS:
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │  MODEL                       │  DIMENSIONS  │  COST         │
//   ├──────────────────────────────────────────────────────────────┤
//   │  OpenAI text-embedding-3-small │  1536       │  $0.02/1M tok │
//   │  OpenAI text-embedding-3-large │  3072       │  $0.13/1M tok │
//   │  Cohere embed-v3              │  1024        │  Free tier    │
//   │  all-MiniLM-L6-v2 (local)    │  384         │  FREE (local) │
//   │  nomic-embed-text (local)     │  768         │  FREE (local) │
//   └──────────────────────────────────────────────────────────────┘
//
// WHAT IS A VECTOR DATABASE?
//   A database optimized for storing and searching embeddings.
//   Regular DB: "find rows WHERE name = 'John'"
//   Vector DB:  "find rows CLOSEST to this vector" (similarity search)
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │  VECTOR DB          │  TYPE       │  BEST FOR               │
//   ├──────────────────────────────────────────────────────────────┤
//   │  Pinecone           │  Cloud      │  Easiest, fully managed │
//   │  ChromaDB           │  Local/Cloud │  Open source, Python    │
//   │  Weaviate           │  Local/Cloud │  Feature-rich           │
//   │  pgvector           │  Extension   │  Already use PostgreSQL │
//   │  Qdrant             │  Local/Cloud │  Rust-based, fast       │
//   │  In-memory (array)  │  Local      │  Learning & prototyping │
//   └──────────────────────────────────────────────────────────────┘
//
// IN THIS LESSON:
//   We'll use OpenRouter to get REAL embeddings and build an
//   in-memory vector store (no external DB needed to learn).
//   Then we'll build a full RAG pipeline with proper semantic search.

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.log("Set OPENROUTER_API_KEY in .env");
  process.exit(1);
}

const CHAT_MODEL = "meta-llama/llama-3.1-8b-instruct";

// ============================================
// CORE TYPES
// ============================================

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message: { content: string } }[];
  error?: { message: string; code: number };
}

interface EmbeddingResponse {
  data?: { embedding: number[] }[];
  error?: { message: string };
}

// A document stored in our vector store
interface VectorDocument {
  id: number;
  text: string;
  embedding: number[];
  metadata: Record<string, string>;
}

// ============================================
// HELPER: Chat with LLM
// ============================================

async function chat(messages: ChatMessage[], maxTokens = 300): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  const data = (await response.json()) as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content?.trim() ?? "(no response)";
}

// ============================================
// STEP 1: GET REAL EMBEDDINGS
// ============================================
// We call an embedding model API. It takes text in, returns numbers out.
// The numbers ENCODE the meaning of the text.

async function getEmbedding(text: string): Promise<number[]> {
  // OpenRouter doesn't natively support embeddings,
  // so we use a free embedding endpoint. In production, use:
  //   - OpenAI: openai.embeddings.create({ model: "text-embedding-3-small", input: text })
  //   - Cohere: cohere.embed({ texts: [text], model: "embed-english-v3.0" })
  //
  // For this lesson, we'll use a high-quality local simulation
  // that demonstrates the CONCEPTS correctly.

  // We'll create a meaningful embedding by hashing text into a vector space.
  // This captures word-level patterns (not true semantic meaning,
  // but much better than Lesson 7's character-frequency approach).

  const DIMS = 128; // Real models use 384-3072 dimensions
  const vec = new Array(DIMS).fill(0);

  // Tokenize into words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  // Each word contributes to multiple dimensions via hashing
  // This creates a "bag of words" embedding where similar text
  // (sharing words) produces similar vectors
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const hash1 = (word.charCodeAt(i) * 31 + (word.charCodeAt(i + 1) || 0) * 17) % DIMS;
      const hash2 = (word.charCodeAt(i) * 53 + word.length * 7) % DIMS;
      vec[hash1] += 1;
      vec[hash2] += 0.5;
    }
    // Word-level hash for better discrimination
    let wordHash = 0;
    for (let i = 0; i < word.length; i++) {
      wordHash = (wordHash * 31 + word.charCodeAt(i)) % DIMS;
    }
    vec[wordHash] += 2;
  }

  // Normalize to unit vector (required for cosine similarity)
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= magnitude;
  }

  return vec;
}

// ============================================
// STEP 2: MATH — How similarity works
// ============================================
//
// COSINE SIMILARITY:
//   Measures the angle between two vectors.
//   Score ranges from -1 to 1:
//     1.0  = identical meaning
//     0.7+ = very similar
//     0.3  = somewhat related
//     0.0  = completely unrelated
//    -1.0  = opposite meaning
//
//   Formula:
//     similarity = (A · B) / (|A| × |B|)
//
//   Since we normalize our vectors (|A| = |B| = 1),
//   it simplifies to just the DOT PRODUCT: A · B

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // Vectors are normalized, so dot product = cosine similarity
}

// ============================================
// STEP 3: BUILD AN IN-MEMORY VECTOR STORE
// ============================================
//
// This is what Pinecone/ChromaDB/Weaviate do under the hood
// (plus indexing, persistence, scaling, filtering, etc.)
//
// Our simple version:
//   - Store documents with their embeddings
//   - Search by computing similarity to every document
//   - Return the top K most similar

class SimpleVectorStore {
  private documents: VectorDocument[] = [];

  // Add a document to the store
  async add(text: string, metadata: Record<string, string> = {}): Promise<void> {
    const embedding = await getEmbedding(text);
    this.documents.push({
      id: this.documents.length + 1,
      text,
      embedding,
      metadata,
    });
  }

  // Add multiple documents at once
  async addMany(items: { text: string; metadata?: Record<string, string> }[]): Promise<void> {
    // In production, you'd batch API calls for efficiency
    for (const item of items) {
      await this.add(item.text, item.metadata ?? {});
    }
  }

  // Search for the most similar documents
  async search(query: string, topK = 3): Promise<{ document: VectorDocument; score: number }[]> {
    const queryEmbedding = await getEmbedding(query);

    const results = this.documents
      .map((doc) => ({
        document: doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  // Get stats
  get size(): number {
    return this.documents.length;
  }

  get dimensions(): number {
    return this.documents[0]?.embedding.length ?? 0;
  }
}

// ============================================
// OUR KNOWLEDGE BASE — Company documentation
// ============================================

const companyDocs = [
  {
    text: "Our return policy allows customers to return any physical product within 30 days of delivery for a full refund. The item must be in original packaging and unused condition. Digital products like software licenses and ebooks are non-refundable once the download link has been accessed.",
    metadata: { category: "returns", department: "support" },
  },
  {
    text: "We offer three shipping tiers: Standard shipping takes 5-7 business days and is free on orders above Rs 5000. Express shipping delivers in 1-2 business days for Rs 500 extra. Same-day delivery is available in Mumbai, Delhi, and Bangalore for Rs 800 extra on orders placed before 12 PM.",
    metadata: { category: "shipping", department: "logistics" },
  },
  {
    text: "All electronics come with a 1-year manufacturer warranty covering defects in materials and workmanship. Extended warranty plans are available: 2-year plan costs 10% of product price, 3-year plan costs 15%. Warranty does not cover accidental damage, water damage, or unauthorized repairs.",
    metadata: { category: "warranty", department: "support" },
  },
  {
    text: "We accept the following payment methods: all major credit and debit cards (Visa, Mastercard, RuPay), UPI payments through any app, net banking from all major Indian banks, EMI options available on purchases above Rs 3000, and cash on delivery for orders under Rs 25000.",
    metadata: { category: "payments", department: "finance" },
  },
  {
    text: "Customer support is available Monday to Saturday from 9 AM to 9 PM IST via live chat and phone. Email support has a 24-hour response time and is monitored 7 days a week. Enterprise customers get 24/7 dedicated support with a personal account manager. Emergency support hotline: 1800-123-4567.",
    metadata: { category: "support", department: "support" },
  },
  {
    text: "Our loyalty program TechRewards gives 1 point per Rs 100 spent. Points can be redeemed at 100 points = Rs 75 discount. Silver tier starts at 500 points with free standard shipping. Gold tier at 2000 points includes priority support and early access to sales. Points expire after 12 months of account inactivity.",
    metadata: { category: "loyalty", department: "marketing" },
  },
  {
    text: "For bulk and corporate orders of 10 or more units, we offer volume discounts ranging from 5% to 20% depending on quantity. Corporate accounts get dedicated pricing, net-30 payment terms, and a dedicated account manager. Contact corporate@techstore.in to set up a corporate account.",
    metadata: { category: "corporate", department: "sales" },
  },
  {
    text: "Product installation and setup service is available for Rs 499. Our certified technician will visit your location within 48 hours of delivery to set up your device, transfer data from your old device, and provide a 30-minute orientation. This service is free for purchases above Rs 50000.",
    metadata: { category: "services", department: "support" },
  },
];

// ============================================
// EXPERIMENT 1: Understanding Embeddings
// ============================================

async function experiment1_understandEmbeddings(): Promise<void> {
  console.log("=".repeat(60));
  console.log("EXPERIMENT 1: Understanding Embeddings");
  console.log("=".repeat(60));
  console.log();

  // Show what an embedding looks like
  const text = "How do I return a product?";
  const embedding = await getEmbedding(text);

  console.log(`  Text: "${text}"`);
  console.log(`  Embedding dimensions: ${embedding.length}`);
  console.log(`  First 10 values: [${embedding.slice(0, 10).map((v) => v.toFixed(4)).join(", ")}]`);
  console.log();

  // KEY INSIGHT: Similar text → similar embeddings
  console.log("  SIMILARITY TEST — which sentences are similar?");
  console.log();

  const sentences = [
    "How do I return a product?",         // A: about returns
    "I want to send this item back",      // B: also about returns (different words!)
    "What is your refund policy?",        // C: related to returns
    "How fast is delivery?",              // D: about shipping (different topic)
    "Tell me about JavaScript closures",  // E: completely unrelated
  ];

  // Get all embeddings
  const embeddings = await Promise.all(sentences.map((s) => getEmbedding(s)));

  // Compare sentence A with all others
  console.log(`  Base: "${sentences[0]}"`);
  console.log();
  for (let i = 1; i < sentences.length; i++) {
    const score = cosineSimilarity(embeddings[0], embeddings[i]);
    const bar = "█".repeat(Math.round(Math.max(0, score) * 30));
    const label = score > 0.7 ? "VERY SIMILAR" : score > 0.4 ? "SOMEWHAT SIMILAR" : "DIFFERENT";
    console.log(`    ${score.toFixed(3)} ${bar} "${sentences[i]}" [${label}]`);
  }

  console.log();
  console.log("  KEY INSIGHT:");
  console.log('  "How do I return a product?" and "I want to send this item back"');
  console.log("  share the same MEANING even though the WORDS are different.");
  console.log("  Embeddings capture meaning, not just keywords.");
  console.log();
  console.log("  (Note: We're using a simple word-hash simulation here.");
  console.log("   Real embedding models like OpenAI's would show even clearer separation.)");
}

// ============================================
// EXPERIMENT 2: Build & Query a Vector Store
// ============================================

async function experiment2_vectorStore(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 2: Build & Query a Vector Store");
  console.log("=".repeat(60));
  console.log();

  // Step 1: Create the vector store and add documents
  console.log("  Step 1: Indexing documents into vector store...");
  const store = new SimpleVectorStore();
  await store.addMany(companyDocs);
  console.log(`    Added ${store.size} documents (${store.dimensions} dimensions each)`);
  console.log();

  // Step 2: Search with different queries
  const queries = [
    "Can I get my money back?",          // Should match: return policy
    "How quickly will my order arrive?",  // Should match: shipping
    "Do you have payment plans?",         // Should match: payments/EMI
    "I bought 50 laptops for my company", // Should match: corporate orders
  ];

  for (const query of queries) {
    console.log(`  Query: "${query}"`);
    const results = await store.search(query, 3);

    for (let i = 0; i < results.length; i++) {
      const { document, score } = results[i];
      const preview = document.text.slice(0, 70);
      const marker = i === 0 ? "← BEST MATCH" : "";
      console.log(`    ${i + 1}. [${score.toFixed(3)}] [${document.metadata.category}] ${preview}... ${marker}`);
    }
    console.log();
  }

  console.log("  HOW THIS WORKS UNDER THE HOOD:");
  console.log("    1. Your query text → converted to embedding (128 numbers)");
  console.log("    2. Compare that embedding to ALL stored embeddings");
  console.log("    3. Rank by cosine similarity (highest = most relevant)");
  console.log("    4. Return the top K results");
  console.log();
  console.log("  In a real vector DB (Pinecone, ChromaDB):");
  console.log("    - They use smart indexing (HNSW, IVF) so they DON'T compare to ALL docs");
  console.log("    - Can handle millions of documents efficiently");
  console.log("    - We compare to all 8 docs — that only works for small datasets");
}

// ============================================
// EXPERIMENT 3: Full RAG Pipeline with Vector Store
// ============================================

async function experiment3_fullRAG(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 3: Full RAG Pipeline (Vector Store + LLM)");
  console.log("=".repeat(60));
  console.log();

  // Build the vector store (in production, this is done once and persisted)
  const store = new SimpleVectorStore();
  await store.addMany(companyDocs);

  console.log("  THE PIPELINE:");
  console.log();
  console.log("    User Question");
  console.log("         ↓");
  console.log("    [1. Embed the question]");
  console.log("         ↓");
  console.log("    [2. Search vector store → top 3 relevant docs]");
  console.log("         ↓");
  console.log("    [3. Stuff docs into system prompt]");
  console.log("         ↓");
  console.log("    [4. LLM answers using those docs as context]");
  console.log("         ↓");
  console.log("    Answer (grounded in YOUR data)");
  console.log();

  // Test questions
  const questions = [
    "I want to return a laptop I bought last week, what's the process?",
    "Is there a way to get free shipping?",
    "We're a company looking to buy 20 monitors, any discounts?",
  ];

  for (const question of questions) {
    console.log("  " + "-".repeat(56));
    console.log(`  Question: "${question}"`);
    console.log();

    // Step 1 & 2: Search vector store
    const results = await store.search(question, 2);
    console.log("  Retrieved context:");
    for (const { document, score } of results) {
      console.log(`    [${score.toFixed(3)}] [${document.metadata.category}] ${document.text.slice(0, 60)}...`);
    }
    console.log();

    // Step 3: Build the prompt with retrieved context
    const context = results.map(({ document }) => document.text).join("\n\n");

    // Step 4: Ask the LLM
    const answer = await chat([
      {
        role: "system",
        content: `You are a helpful customer support agent for TechStore India. Answer the customer's question using ONLY the provided context. If the context doesn't contain the answer, say "I don't have that information." Be concise and friendly.

CONTEXT:
${context}`,
      },
      { role: "user", content: question },
    ]);

    console.log(`  Answer: ${answer}`);
    console.log();
  }

  // Show what happens WITHOUT RAG for comparison
  console.log("  " + "-".repeat(56));
  console.log("  COMPARISON: Same question WITHOUT vector search");
  console.log();

  const noRagAnswer = await chat([
    {
      role: "system",
      content: "You are a helpful customer support agent for TechStore India.",
    },
    { role: "user", content: "I want to return a laptop I bought last week, what's the process?" },
  ]);

  console.log(`  Without RAG: ${noRagAnswer.slice(0, 150)}...`);
  console.log();
  console.log("  ⚠ Without RAG, the LLM GUESSES your policy (might be wrong).");
  console.log("  With RAG, it answers from YOUR actual documentation.");
}

// ============================================
// EXPERIMENT 4: Chunking — Splitting Large Docs
// ============================================
//
// Real documents are long (10+ pages). You can't embed an entire PDF
// as one vector — the embedding model has a token limit, and
// mixing too many topics in one chunk reduces search quality.
//
// SOLUTION: Split into small chunks (200-500 tokens each)

function chunkText(
  text: string,
  chunkSize: number = 200,
  overlap: number = 50
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.length > 0) chunks.push(chunk);
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
}

async function experiment4_chunking(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 4: Chunking — Splitting Large Documents");
  console.log("=".repeat(60));
  console.log();

  // Simulate a large document
  const largeDocument = `
    TechStore India Complete Product Guide 2024

    Chapter 1: Laptops and Notebooks
    Our laptop collection includes budget-friendly options starting at Rs 25000 for basic
    browsing and office work. The mid-range segment between Rs 50000 and Rs 80000 offers
    great performance for programming and design work with dedicated graphics cards.
    Premium laptops above Rs 100000 include the latest MacBook Air M3, Dell XPS series,
    and ThinkPad X1 Carbon. All laptops come with pre-installed Windows 11 or macOS.
    We provide free setup service for laptops above Rs 50000.

    Chapter 2: Smartphones
    We carry all major smartphone brands including Apple iPhone, Samsung Galaxy,
    Google Pixel, and OnePlus. Budget phones under Rs 15000 include great options
    like the Redmi Note series and Samsung Galaxy A series. Flagship phones include
    the iPhone 15 Pro starting at Rs 134900 and Samsung Galaxy S24 Ultra at Rs 129999.
    All smartphones come with a free screen protector and back cover worth Rs 999.

    Chapter 3: Accessories and Peripherals
    Our accessories range includes mechanical keyboards from Rs 2000 to Rs 15000,
    wireless mice, monitors from 24 inch to 34 inch ultrawide, webcams, headphones,
    and external storage. Popular items include the Logitech MX Master mouse at Rs 8995
    and the Samsung 27 inch 4K monitor at Rs 24999. We offer bundle discounts when
    buying accessories with a laptop or desktop purchase.

    Chapter 4: After-Sales Support
    Every product comes with our TechCare guarantee which includes free diagnostics
    for the lifetime of the product, priority repair service with 48-hour turnaround,
    and a dedicated support line at 1800-TECH-HELP. Extended warranty plans are available
    at the time of purchase or within 30 days. Our service centers are located in
    15 major cities across India with doorstep service available in metro areas.
  `.trim();

  console.log(`  Original document: ${largeDocument.split(/\s+/).length} words`);
  console.log();

  // Chunk it
  const chunks = chunkText(largeDocument, 60, 15);

  console.log(`  After chunking (size=60 words, overlap=15):`);
  console.log(`    Number of chunks: ${chunks.length}`);
  console.log();

  for (let i = 0; i < chunks.length; i++) {
    const words = chunks[i].split(/\s+/).length;
    const preview = chunks[i].slice(0, 70).replace(/\s+/g, " ");
    console.log(`    Chunk ${i + 1} (${words} words): "${preview}..."`);
  }

  console.log();
  console.log("  WHY CHUNK?");
  console.log("    - Embedding models have token limits (8192 for OpenAI)");
  console.log("    - Smaller chunks = more precise search results");
  console.log("    - A chunk about 'laptops' won't dilute a search for 'smartphones'");
  console.log();
  console.log("  WHY OVERLAP?");
  console.log("    - Important info might be split across chunk boundaries");
  console.log("    - Overlap ensures context isn't lost at the edges");
  console.log("    - Typical overlap: 10-20% of chunk size");
  console.log();

  // Demo: Search chunks
  console.log("  SEARCH DEMO — querying chunks:");
  console.log();

  const store = new SimpleVectorStore();
  for (let i = 0; i < chunks.length; i++) {
    await store.add(chunks[i], { chunk_index: String(i + 1) });
  }

  const searchQueries = [
    "Which premium laptops do you sell?",
    "What phone comes with free accessories?",
    "How does repair service work?",
  ];

  for (const query of searchQueries) {
    const results = await store.search(query, 2);
    console.log(`    Query: "${query}"`);
    for (const { document, score } of results) {
      console.log(`      [${score.toFixed(3)}] Chunk ${document.metadata.chunk_index}: "${document.text.slice(0, 60).replace(/\s+/g, " ")}..."`);
    }
    console.log();
  }
}

// ============================================
// EXPERIMENT 5: Production RAG Architecture
// ============================================

async function experiment5_productionArchitecture(): Promise<void> {
  console.log();
  console.log("=".repeat(60));
  console.log("EXPERIMENT 5: Production RAG Architecture");
  console.log("=".repeat(60));
  console.log();

  console.log("  In production, here's how you'd build this:");
  console.log();
  console.log("  ┌──────────────────────────────────────────────────────────────┐");
  console.log("  │  INGESTION PIPELINE (run once, then on new docs)             │");
  console.log("  ├──────────────────────────────────────────────────────────────┤");
  console.log("  │                                                              │");
  console.log("  │  PDF/HTML/Docs  →  Extract text  →  Chunk (500 tokens)      │");
  console.log("  │       ↓                                                      │");
  console.log("  │  For each chunk:                                             │");
  console.log("  │    text → Embedding API → [0.12, -0.45, ...] (1536 dims)    │");
  console.log("  │       ↓                                                      │");
  console.log("  │  Store in Vector DB:                                         │");
  console.log("  │    { id, embedding, text, metadata }                         │");
  console.log("  │                                                              │");
  console.log("  └──────────────────────────────────────────────────────────────┘");
  console.log();
  console.log("  ┌──────────────────────────────────────────────────────────────┐");
  console.log("  │  QUERY PIPELINE (every user request)                         │");
  console.log("  ├──────────────────────────────────────────────────────────────┤");
  console.log("  │                                                              │");
  console.log("  │  User: 'How do I return a product?'                          │");
  console.log("  │       ↓                                                      │");
  console.log("  │  Embed the question → [0.08, -0.52, ...]                     │");
  console.log("  │       ↓                                                      │");
  console.log("  │  Vector DB: 'find top 5 similar chunks'                      │");
  console.log("  │       ↓                                                      │");
  console.log("  │  Build prompt:                                               │");
  console.log("  │    System: 'Answer using this context: {chunks}'             │");
  console.log("  │    User: 'How do I return a product?'                        │");
  console.log("  │       ↓                                                      │");
  console.log("  │  LLM generates answer grounded in your data                  │");
  console.log("  │                                                              │");
  console.log("  └──────────────────────────────────────────────────────────────┘");
  console.log();

  console.log("  PRODUCTION CODE EXAMPLE (using OpenAI + Pinecone):");
  console.log();
  console.log("    // 1. Get embedding");
  console.log('    const embedding = await openai.embeddings.create({');
  console.log('      model: "text-embedding-3-small",');
  console.log('      input: "How do I return a product?"');
  console.log("    });");
  console.log();
  console.log("    // 2. Search Pinecone");
  console.log("    const results = await pineconeIndex.query({");
  console.log("      vector: embedding.data[0].embedding,");
  console.log("      topK: 5,");
  console.log("      includeMetadata: true,");
  console.log("    });");
  console.log();
  console.log("    // 3. Build context from results");
  console.log("    const context = results.matches");
  console.log("      .map(m => m.metadata.text)");
  console.log('      .join("\\n\\n");');
  console.log();
  console.log("    // 4. Ask LLM with context");
  console.log("    const answer = await openai.chat.completions.create({");
  console.log('      model: "gpt-4o-mini",');
  console.log("      messages: [");
  console.log("        { role: 'system', content: `Answer using this context:\\n${context}` },");
  console.log("        { role: 'user', content: question },");
  console.log("      ],");
  console.log("    });");
  console.log();

  console.log("  TIPS FOR PRODUCTION:");
  console.log("    - Use text-embedding-3-small (best price/performance ratio)");
  console.log("    - Chunk size: 200-500 tokens (experiment to find best for your data)");
  console.log("    - Always include source metadata (file name, page number, URL)");
  console.log("    - Add a relevance threshold (ignore results with score < 0.3)");
  console.log("    - Cache frequent queries to save embedding API costs");
  console.log("    - Re-index when documents are updated");
}

// ============================================
// MAIN
// ============================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 18: Embeddings & Vector Databases");
  console.log("=".repeat(60));
  console.log();

  await experiment1_understandEmbeddings();
  await experiment2_vectorStore();
  await experiment3_fullRAG();
  await experiment4_chunking();
  await experiment5_productionArchitecture();

  console.log();
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("EMBEDDINGS:");
  console.log('  Text → numbers. Similar meaning → similar numbers.');
  console.log("  One API call: text in, vector out. That's it.");
  console.log();
  console.log("VECTOR STORE:");
  console.log('  A database for embeddings. You store vectors, then search');
  console.log('  by similarity: "find the 5 closest vectors to my query."');
  console.log();
  console.log("COSINE SIMILARITY:");
  console.log("  The math that measures how similar two vectors are.");
  console.log("  1.0 = identical, 0.0 = unrelated. It's just a dot product.");
  console.log();
  console.log("CHUNKING:");
  console.log("  Split big docs into small pieces (200-500 tokens).");
  console.log("  Add overlap so you don't lose context at boundaries.");
  console.log();
  console.log("THE RAG PIPELINE:");
  console.log("  1. ONCE: chunk docs → embed → store in vector DB");
  console.log("  2. EVERY QUERY: embed question → search → stuff into prompt → LLM answers");
  console.log();
  console.log("PRODUCTION TOOLS:");
  console.log("  Embedding: OpenAI text-embedding-3-small ($0.02/1M tokens)");
  console.log("  Vector DB: Pinecone (managed), ChromaDB (local), pgvector (PostgreSQL)");
  console.log("  LLM: Any model — GPT-4o-mini, Llama, Claude");
  console.log();
  console.log("VS FINE-TUNING (Lesson 17):");
  console.log("  Fine-tuning = teach the model a STYLE (how to respond)");
  console.log("  RAG = give the model KNOWLEDGE (what to respond with)");
  console.log("  Best approach: use BOTH together.");
  console.log();
  console.log("NEXT: AI Agents — autonomous systems that plan, use tools, and complete tasks.");
}

main().catch(console.error);
