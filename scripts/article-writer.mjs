// Turns a YouTube description (+ the master prompt) into the blog article shown under the prompt.
//   • With GEMINI_API_KEY set: Gemini writes an original step-by-step guide.
//   • Without a key, or if Gemini fails: the description itself is cleaned up into a formatted article.
import { GoogleGenAI } from "@google/genai";
import { site } from "./lib.mjs";

const MODEL = site.articleWriter?.model || "gemini-3.8-flash";

const SYSTEM = `You write blog articles for NumenAI Studio, a YouTube channel that teaches people to create AI videos with free tools and "master prompts".

Each article sits on a page directly under the video and the master prompt (which has its own Copy and Download buttons). Your article is the written guide that goes with them.

Voice: calm, friendly and practical, like a creator walking a friend through their screen. Plain English, short paragraphs, second person ("you"). No hype words such as "game-changer", "revolutionary" or "unleash".

Facts: use only what is in the video title, the description and the master prompt. Never invent tools, model names, settings, prices, numbers or results. If a detail is not given, keep that part general instead of guessing.

Structure (Markdown, no H1, the page already shows the title):
1. Two short intro paragraphs: what the reader will make and why this style is popular.
2. "## What you'll make": 3-5 bullet points.
3. "## What you need": the tools mentioned, one bullet each with what it is used for.
4. "## Step-by-step": numbered "### Step N: ..." sections that follow the workflow in the description. Tell readers to copy the master prompt above, not to look for a link.
5. "## Tips for better results": 3-5 bullets drawn from the description and the master prompt.
6. "## FAQ": 3 questions a beginner would ask, each as "### Question?" with a 1-3 sentence answer.
7. One closing line inviting readers to watch the full video and leave a comment.

Length: 700-1,100 words. Do not paste the master prompt itself, and include no URLs or hashtags.`;

const SCHEMA = {
  type: "object",
  properties: {
    seoTitle: { type: "string", description: "Title for Google results, 45-60 characters. Put the main search phrase first (e.g. 'AI Family Cartoon Videos'), mention it is free or a master prompt if it fits. Normal capitalisation, no ALL CAPS words, no emojis, no brand name." },
    metaDescription: { type: "string", description: "One sentence for Google results and post cards, 120-155 characters, no emojis." },
    article: { type: "string", description: "The full article in Markdown, following the required structure." },
  },
  required: ["seoTitle", "metaDescription", "article"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askGemini({ title, description, prompt }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents =
    `VIDEO TITLE:\n${title}\n\nVIDEO DESCRIPTION:\n${description || "(none)"}\n\n` +
    `MASTER PROMPT (for context only, do not paste it):\n${prompt || "(none)"}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents,
        config: { systemInstruction: SYSTEM, responseMimeType: "application/json", responseJsonSchema: SCHEMA },
      });
      const data = JSON.parse(res.text || "{}");
      const words = String(data.article || "").split(/\s+/).filter(Boolean).length;
      if (words < 300) throw new Error(`article too short (${words} words)`);
      const u = res.usageMetadata || {};
      const usage = { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), thinking: u.thoughtsTokenCount || 0 };
      // Markdown only treats "-" / "*" as bullets; models sometimes use "•"
      data.article = String(data.article).replace(/^[ \t]*[•●▪◦][ \t]+/gm, "- ");
      return { article: data.article.trim(), metaDescription: String(data.metaDescription || "").trim(), seoTitle: String(data.seoTitle || "").trim(), words, usage };
    } catch (err) {
      const status = err?.status;
      // Free tier has per-minute limits: wait and retry on 429 / temporary errors
      if (attempt < 3 && (status === 429 || status >= 500)) { await sleep(20000 * attempt); continue; }
      throw err;
    }
  }
}

// Cleans a YouTube description into readable Markdown (used when there is no key or Gemini fails)
export function formatDescription(desc) {
  const out = [];
  const chapters = [];
  let promptNoteAdded = false;
  let section = ""; // current heading, so "Name — use" lines only become tool bullets under a tools heading
  for (let raw of String(desc || "").replace(/\r/g, "").split("\n")) {
    let line = raw.trim();
    if (/docs\.google\.com|drive\.google\.com/.test(line)) {                  // never expose Doc links
      if (!promptNoteAdded) out.push("*The master prompt is in the box above. Copy it, or download it as Word, PDF or text.*");
      promptNoteAdded = true;
      continue;
    }
    if (/^(#[\w-]+\s*)+$/.test(line)) continue;                                // hashtag-only lines
    const plain = line
      .replace(/\*\*/g, "")
      .replace(/^#{1,6}\s+/, "")                                               // "### AI TOOLS USED:"
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
      .trim();
    const ts = plain.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—:]?\s*(.+)$/);
    if (ts) { chapters.push(`- **${ts[1]}** ${ts[2]}`); continue; }
    if (!plain) { out.push(""); continue; }
    if (/^(chapters|timestamps)\s*:?$/i.test(plain)) continue;                // we add our own Chapters heading
    if (/^(?:[✅✔☑•▶►👉]|[-*]\s)/u.test(line)) { out.push("- " + plain.replace(/^[-*•]\s*/, "")); continue; }
    const tool = /tool/i.test(section) && plain.match(/^([^—–:]{2,40}?)\s+[—–]\s+(.+)$/); // "Claude AI — Story planning"
    if (tool) { out.push(`- **${tool[1]}**: ${tool[2]}`); continue; }
    const letters = plain.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 4 && plain.length <= 70 && (plain === plain.toUpperCase() || /:$/.test(plain)) && !/https?:/.test(plain)) {
      const heading = plain.replace(/:$/, "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()).replace(/\bai\b/gi, "AI");
      out.push("", "## " + heading, "");
      section = heading;
      continue;
    }
    out.push(plain.replace(/(https?:\/\/\S+)/g, "<$1>"));
  }
  let md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (chapters.length) md += "\n\n## Chapters\n\n" + chapters.join("\n");
  return md;
}

/** Returns { body, source: "ai" | "description", metaDescription?, note } */
export async function writeArticle({ title, description, prompt }) {
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await askGemini({ title, description, prompt });
      const t = r.usage;
      return {
        body: r.article, metaDescription: r.metaDescription, seoTitle: r.seoTitle, source: "ai", usage: t,
        note: `Gemini (${MODEL}), ${r.words} words, ${t.input.toLocaleString()} input + ${t.output.toLocaleString()} output tokens`,
      };
    } catch (err) {
      return { body: formatDescription(description), source: "description", note: `Gemini failed (${err.message}), used formatted description` };
    }
  }
  return { body: formatDescription(description), source: "description", note: "no GEMINI_API_KEY, used formatted description" };
}
