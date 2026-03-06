import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

// ============================================
// LESSON 11: Vision / Multimodal
// ============================================
//
// LLMs aren't text-only anymore. Vision models can:
//   - Describe images
//   - Read text from screenshots (OCR)
//   - Analyze charts/diagrams
//   - Answer questions about photos
//   - Compare multiple images
//
// HOW IT WORKS:
//   Instead of sending just text in messages, you send an array
//   of "content parts" — text AND images mixed together.
//
//   Before (text only):
//     { role: "user", content: "What is this?" }
//
//   Now (multimodal):
//     { role: "user", content: [
//         { type: "text", text: "What is this?" },
//         { type: "image_url", image_url: { url: "https://..." } }
//     ]}
//
// TWO WAYS TO SEND IMAGES:
//   1. URL:    image_url: { url: "https://example.com/photo.jpg" }
//   2. Base64: image_url: { url: "data:image/png;base64,iVBOR..." }

interface TextPart {
  type: "text";
  text: string;
}

interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

interface Message {
  role: "system" | "user" | "assistant";
  content: string | (TextPart | ImagePart)[];
}

interface ChatCompletionResponse {
  choices?: { message: { role: string; content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; code: number };
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) { console.log("Set OPENROUTER_API_KEY in .env"); process.exit(1); }

// Vision-capable models (not all models support images)
const VISION_MODEL = "google/gemma-3-12b-it:free";  // free and supports vision

async function chat(messages: Message[], maxTokens = 300): Promise<{ content: string; tokens: number }> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });

  const data = await response.json() as ChatCompletionResponse;
  if (data.error) throw new Error(data.error.message);
  return {
    content: data.choices?.[0]?.message?.content?.trim() ?? "(no response)",
    tokens: data.usage?.total_tokens ?? 0,
  };
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("LESSON 11: Vision / Multimodal");
  console.log("=".repeat(60));
  console.log(`Model: ${VISION_MODEL}`);
  console.log();

  // ============================================
  // EXPERIMENT 1: Describe an image from URL
  // ============================================
  console.log("EXPERIMENT 1: Describe an image from URL");
  console.log("-".repeat(60));
  console.log();

  // Using a publicly available sample image
  const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png";

  const result1 = await chat([
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image in detail. What do you see?" },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ]);

  console.log(`  Image: ${imageUrl}`);
  console.log(`  AI: ${result1.content}`);
  console.log(`  Tokens used: ${result1.tokens}`);
  console.log();

  // ============================================
  // EXPERIMENT 2: Ask specific questions about an image
  // ============================================
  console.log("EXPERIMENT 2: Ask questions about an image");
  console.log("-".repeat(60));
  console.log();

  const codeScreenshot = "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg/800px-Good_Food_Display_-_NCI_Visuals_Online.jpg";

  const result2 = await chat([
    {
      role: "user",
      content: [
        { type: "text", text: "List all the food items you can see in this image. Be specific." },
        { type: "image_url", image_url: { url: codeScreenshot } },
      ],
    },
  ]);

  console.log(`  AI: ${result2.content}`);
  console.log(`  Tokens: ${result2.tokens}`);
  console.log();

  // ============================================
  // EXPERIMENT 3: Send a local image as base64
  // ============================================
  console.log("EXPERIMENT 3: Send a local image as base64");
  console.log("-".repeat(60));
  console.log();

  // Create a simple test image (1x1 red pixel PNG) to demonstrate base64
  // In a real app, you'd read an actual file: fs.readFileSync("photo.jpg")
  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

  const result3 = await chat([
    {
      role: "user",
      content: [
        { type: "text", text: "What do you see in this image? Describe the color." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${tinyPng}` } },
      ],
    },
  ]);

  console.log("  (Sent a tiny 1x1 pixel image as base64)");
  console.log(`  AI: ${result3.content}`);
  console.log();

  // Show how to read a real local file
  console.log("  How to send a real local file:");
  console.log('    const imageBuffer = fs.readFileSync("./photo.jpg");');
  console.log('    const base64 = imageBuffer.toString("base64");');
  console.log('    const url = `data:image/jpeg;base64,${base64}`;');
  console.log();

  // ============================================
  // EXPERIMENT 4: Multiple images in one request
  // ============================================
  console.log("EXPERIMENT 4: Compare two images");
  console.log("-".repeat(60));
  console.log();

  const img1 = "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg";
  const img2 = "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/1200px-YellowLabradorLooking_new.jpg";

  const result4 = await chat([
    {
      role: "user",
      content: [
        { type: "text", text: "Compare these two images. What animal is in each? What are the differences?" },
        { type: "image_url", image_url: { url: img1 } },
        { type: "image_url", image_url: { url: img2 } },
      ],
    },
  ]);

  console.log(`  Image 1: Cat`);
  console.log(`  Image 2: Dog`);
  console.log(`  AI: ${result4.content}`);
  console.log(`  Tokens: ${result4.tokens}`);
  console.log();

  // ============================================
  // EXPERIMENT 5: OCR — read text from an image
  // ============================================
  console.log("EXPERIMENT 5: OCR — read text from screenshot");
  console.log("-".repeat(60));
  console.log();

  const textImage = "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Poster_for_%22The_Raven%22_by_Edgar_Allan_Poe.png/440px-Poster_for_%22The_Raven%22_by_Edgar_Allan_Poe.png";

  const result5 = await chat([
    {
      role: "user",
      content: [
        { type: "text", text: "Read all the text you can see in this image. Transcribe it exactly." },
        { type: "image_url", image_url: { url: textImage } },
      ],
    },
  ], 500);

  console.log(`  AI: ${result5.content}`);
  console.log();

  // ============================================
  // SUMMARY
  // ============================================
  console.log("=".repeat(60));
  console.log("KEY TAKEAWAYS:");
  console.log("=".repeat(60));
  console.log();
  console.log("HOW TO SEND IMAGES:");
  console.log('  content: [');
  console.log('    { type: "text", text: "your question" },');
  console.log('    { type: "image_url", image_url: { url: "https://..." } }');
  console.log('  ]');
  console.log();
  console.log("TWO WAYS TO PASS IMAGES:");
  console.log("  1. URL:    https://example.com/photo.jpg");
  console.log("  2. Base64: data:image/jpeg;base64,/9j/4AAQ...");
  console.log();
  console.log("VISION-CAPABLE MODELS ON OPENROUTER:");
  console.log("  Free:  google/gemma-3-12b-it:free");
  console.log("         nvidia/nemotron-nano-12b-v2-vl:free");
  console.log("  Cheap: google/gemma-3n-e4b-it ($0.02/1M)");
  console.log("  Best:  openai/gpt-4o, anthropic/claude-sonnet-4");
  console.log();
  console.log("USE CASES:");
  console.log("  - OCR: read text from screenshots, documents, receipts");
  console.log("  - Analysis: describe photos, count objects, read charts");
  console.log("  - Comparison: spot differences between images");
  console.log("  - Code: screenshot of UI → generate HTML/CSS");
  console.log("  - Accessibility: describe images for visually impaired");
  console.log();
  console.log("COST NOTE:");
  console.log("  Images use MORE tokens than text. A single image can be");
  console.log("  500-2000 tokens depending on resolution. Keep this in mind.");
  console.log();
  console.log("NEXT LESSON: Using the OpenAI SDK instead of raw fetch.");
}

main().catch(console.error);
