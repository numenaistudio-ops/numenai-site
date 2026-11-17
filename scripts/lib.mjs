// Shared helpers for the automation scripts: paths, settings, front matter editing, YouTube feed.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POSTS = path.join(ROOT, "src/blog/posts");
export const site = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/site.json"), "utf8"));

// Local secrets (GEMINI_API_KEY) live in .env, which is never committed. On GitHub they come from Secrets.
try { process.loadEnvFile(path.join(ROOT, ".env")); } catch {}

export const yamlStr = (s) => JSON.stringify(String(s)); // JSON strings are valid YAML
export const shortHash = (s) => crypto.createHash("sha1").update(String(s).trim()).digest("hex").slice(0, 12);

// ---- Front matter ----
const split = (text) => {
  const end = text.indexOf("\n---", 4);
  return { fm: text.slice(0, end + 1), rest: text.slice(end + 1) }; // rest starts with "---\n..."
};
export function getField(text, key) {
  const m = split(text).fm.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!m) return undefined;
  const v = m[1].trim();
  try { return v.startsWith('"') ? JSON.parse(v) : v; } catch { return v; }
}
export function setField(text, key, value) {
  let { fm, rest } = split(text);
  const line = `${key}: ${value}\n`;
  const re = new RegExp(`^${key}:[^\\n]*\\n`, "m");
  if (re.test(fm)) fm = fm.replace(re, line);
  else if (/^prompt:/m.test(fm)) fm = fm.replace(/^prompt:/m, line + "prompt:");
  else fm += line;
  return fm + rest;
}
export function getPrompt(text) {
  const m = split(text).fm.match(/^prompt: \|-?\n((?:(?: {2}[^\n]*|)\n)*)/m);
  return m ? m[1].split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n").trim() : "";
}
export function setPrompt(text, prompt) {
  const block = "prompt: |-\n" + prompt.split("\n").map((l) => (l ? "  " + l : "")).join("\n") + "\n";
  let { fm, rest } = split(text);
  const re = /^prompt:[^\n]*\n(?:(?: {2}[^\n]*|)\n)*/m;
  fm = re.test(fm) ? fm.replace(re, block) : fm + block;
  return fm + rest;
}
export const getBody = (text) => split(text).rest.replace(/^---\n/, "").trim();
export const setBody = (text, body) => split(text).fm + "---\n\n" + body.trim() + "\n";

// ---- YouTube feed (public, no key needed) ----
const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };
export async function getFeed() {
  // YouTube caches the feed for up to 15 minutes; a unique "_" value asks for a fresh copy so new uploads show up at once
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${site.youtubeChannelId}&_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`YouTube feed request failed: HTTP ${res.status}`);
  const xml = await res.text();
  return xml.split("<entry>").slice(1).map((e) => ({
    id: tag(e, "yt:videoId"),
    title: tag(e, "title"),
    published: tag(e, "published").slice(0, 10),
    description: tag(e, "media:description"),
    isShort: /<link[^>]+href="https:\/\/www\.youtube\.com\/shorts\//.test(e),
  }));
}

// Map of youtubeId → { file, text } for every post
export function loadPosts() {
  const map = new Map();
  for (const f of fs.readdirSync(POSTS).filter((f) => f.endsWith(".md"))) {
    const file = path.join(POSTS, f);
    const text = fs.readFileSync(file, "utf8");
    const id = getField(text, "youtubeId");
    if (id) map.set(id, { file, text, slug: path.basename(f, ".md") });
  }
  return map;
}

// ---- Master prompt folder in Google Drive (shared "Anyone with the link", read without a key) ----
// Returns [{ id, name }] for every Google Doc in the folder (sub-folders are ignored).
export async function getFolderDocs(folderId = site.promptsFolderId) {
  if (!folderId) return [];
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, { redirect: "follow" });
  if (!res.ok) throw new Error(`Prompt folder could not be read (HTTP ${res.status}). Is it shared as "Anyone with the link"?`);
  const html = await res.text();
  const docs = [];
  for (const m of html.matchAll(/docs\.google\.com\/document\/d\/([\w-]{20,})[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g))
    docs.push({ id: m[1], name: decode(m[2]).trim() });
  return docs;
}

// Title matching: Doc names only need to be roughly the same as the YouTube title.
const FILLER = new Set(["a", "an", "the", "for", "with", "and", "to", "of", "in", "on", "how", "1", "one", "master", "prompt", "free", "viral", "ai", "video", "videos", "create", "make", "your"]);
export const titleWords = (t) =>
  String(t).toLowerCase().replace(/\.(docx?|txt|pdf)$/, "").replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !FILLER.has(w));
export const normTitle = (t) => titleWords(t).join(" ");
// 0..1, how much of the shorter title's important words appear in the other one
export function titleScore(a, b) {
  const A = new Set(titleWords(a)), B = new Set(titleWords(b));
  if (!A.size || !B.size) return 0;
  if (normTitle(a) === normTitle(b)) return 1;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size); // Dice coefficient
}

// ---- "Tools used" sidebar, built from the article's "## What you need" list ----
// Known tools get a link and a short label; anything else is shown by name only.
const KNOWN_TOOLS = [
  [/^claude/i, "Claude", "https://claude.ai", "Script & prompts"],
  [/^chat ?gpt/i, "ChatGPT", "https://chatgpt.com", "Script & prompts"],
  [/^(google )?gemini|nano banana/i, "Google Gemini", "https://gemini.google.com", "Images"],
  [/^(google )?flow/i, "Google Flow", "https://labs.google/flow", "Video clips"],
  [/^eleven ?labs/i, "ElevenLabs", "https://elevenlabs.io", "Voiceover"],
  [/^suno/i, "Suno", "https://suno.com", "Music"],
  [/^cap ?cut/i, "CapCut", "https://www.capcut.com", "Editing"],
  [/filmora/i, "Wondershare Filmora", "https://filmora.wondershare.com", "Editing"],
  [/^kling/i, "Kling", "https://klingai.com", "Video clips"],
  [/^veo/i, "Veo", "https://deepmind.google/models/veo/", "Video clips"],
  [/^seedance/i, "Seedance", "https://seed.bytedance.com/en/seedance", "Video clips"],
  [/^higgsfield/i, "Higgsfield", "https://higgsfield.ai", "Video clips"],
];
export function toolsFromArticle(body) {
  const sec = (String(body).match(/(?:^|\n)## What you need\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/) || [])[1] || "";
  const tools = [], seen = new Set();
  for (const m of sec.matchAll(/^[-*]\s+\**([^:*\n]+?)\**\s*:/gm)) {
    // "ChatGPT, Claude, or Gemini" → three tools; "Google Flow (Agent mode)" → "Google Flow"
    for (let name of m[1].split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/)) {
      name = name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+AI$/i, "").trim();
      if (!name) continue;
      const k = KNOWN_TOOLS.find(([re]) => re.test(name));
      const tool = k ? { name: k[1], url: k[2], note: k[3] } : { name };
      if (seen.has(tool.name)) continue;
      seen.add(tool.name); tools.push(tool);
    }
  }
  return tools;
}
export function setTools(text, tools) {
  if (!tools.length) return text;
  const block = "tools:\n" + tools.map((t) =>
    `  - name: ${yamlStr(t.name)}\n` + (t.url ? `    url: ${t.url}\n` : "") + (t.note ? `    note: ${yamlStr(t.note)}\n` : "")).join("");
  const fmEnd = text.indexOf("\n---", 4);
  let fm = text.slice(0, fmEnd + 1);
  const re = /^tools:[^\n]*\n(?:(?: {2}|- )[^\n]*\n)*/m;
  fm = re.test(fm) ? fm.replace(re, block) : (/^prompt:/m.test(fm) ? fm.replace(/^prompt:/m, block + "prompt:") : fm + block);
  return fm + text.slice(fmEnd + 1);
}
