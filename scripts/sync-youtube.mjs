// Sync master prompts from YouTube → website posts.
//
// The master prompt folder in Google Drive (site.json → promptsFolderId) is the ONLY source of prompts.
// A video gets its prompt from:
//   1. the folder Doc it was paired with before (promptDocId in the post), or
//   2. a folder Doc named like the video title. Small differences are fine (capitals, emojis,
//      "(1 Master Prompt)", a missing word); the pairing is then saved in the post.
// Google Doc links in video descriptions are ignored. A post with no matching Doc in the folder is never
// changed, so older posts keep their prompt until you add a Doc for them to the folder.
// For every video that has a prompt Doc:
//   • existing post (matched by youtubeId) → refresh its master prompt (+ Word/PDF) from the Doc
//   • no post yet                          → create a new post with an article written from the description
// Shorts and videos with no Doc in the folder are skipped. Then any auto-imported post still missing an
// AI article gets one (see write-articles.mjs). No login needed: the Doc must be shared as
// "Anyone with the link can view". Gemini articles need GEMINI_API_KEY (optional).
//
// Run:  npm run sync            (writes changes)
//       npm run sync -- --dry-run

import fs from "node:fs";
import path from "node:path";
import { ROOT, POSTS, yamlStr, shortHash, getField, setField, setPrompt, getFeed, loadPosts, getFolderDocs, titleScore, setTools, toolsFromArticle } from "./lib.mjs";
import { writeArticle } from "./article-writer.mjs";
import { updateArticles } from "./write-articles.mjs";

const DRY = process.argv.includes("--dry-run");

async function getDocText(docId) {
  const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, { redirect: "follow" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("text/plain")) throw new Error(`Doc ${docId} is not public (HTTP ${res.status}, ${type})`);
  return (await res.text()).replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Formatted copies of the Doc (Word + PDF), saved on the website itself
const FILES = path.join(ROOT, "src/assets/prompts");
const FORMATS = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf" };
async function saveFormattedFiles(docId, slug) {
  fs.mkdirSync(FILES, { recursive: true });
  const saved = {};
  for (const [ext, type] of Object.entries(FORMATS)) {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=${ext}`, { redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") || "").startsWith(type)) throw new Error(`Could not export Doc ${docId} as ${ext}`);
    if (!DRY) fs.writeFileSync(path.join(FILES, `${slug}.${ext}`), Buffer.from(await res.arrayBuffer()));
    saved[ext] = `/assets/prompts/${slug}.${ext}`;
  }
  return saved;
}
const filesExist = (slug) => Object.keys(FORMATS).every((ext) => fs.existsSync(path.join(FILES, `${slug}.${ext}`)));

const guessCategory = (t) => {
  t = t.toLowerCase();
  if (/stick ?man/.test(t)) return "Stickman";
  if (/documentar/.test(t)) return "Documentary";
  if (/nursery|kids|cocomelon|baby song/.test(t)) return "Kids";
  if (/\bads?\b|ugc|product/.test(t)) return "Ads";
  if (/music video|song/.test(t)) return "Music Video";
  if (/cartoon|anim/.test(t)) return "Cartoon";
  return "Tutorial";
};
const slugify = (t) =>
  t.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(how to|create|make|viral|free|with|for|the|a|1|master prompt)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "") || "post";
const fallbackDescription = (d) => {
  const firstPara = d.replace(/\*\*/g, "").split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 60 && !/^https?:/.test(p)) || d;
  const plain = firstPara.replace(/https?:\S+/g, "").replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, "").replace(/\s+/g, " ").trim();
  return plain.length > 180 ? plain.slice(0, 177).replace(/\s\S*$/, "") + "…" : plain;
};

const existing = loadPosts();
const feed = await getFeed();
const report = { updated: [], unchanged: [], created: [], skipped: [], errors: [], "folder docs waiting for a video": [] };

// Prompt folder. If it can't be read, nothing is changed this run.
let folderDocs = [];
try { folderDocs = await getFolderDocs(); } catch (err) { report.errors.push(err.message); }
const inFolder = new Set(folderDocs.map((d) => d.id));
// Docs already paired with a post are not offered to other videos
const claimed = new Set([...existing.values()].map((p) => getField(p.text, "promptDocId")).filter((id) => inFolder.has(id)));
const MATCH = 0.75; // how similar a Doc name must be to the video title (0..1)
function folderMatch(title) {
  const ranked = folderDocs.filter((d) => !claimed.has(d.id))
    .map((d) => ({ ...d, score: titleScore(title, d.name) })).sort((a, b) => b.score - a.score);
  const [best, next] = ranked;
  if (!best || best.score < MATCH) return null;
  if (next && next.score === best.score) return null; // two Docs fit equally well: don't guess
  return best;
}

for (const v of feed) {
  if (v.isShort || /#shorts/i.test(v.title)) { report.skipped.push(`${v.title} (Short)`); continue; }
  const post = existing.get(v.id);
  const paired = post && getField(post.text, "promptDocId");
  let docId = null, via = "";
  if (paired && inFolder.has(paired)) { docId = paired; via = "paired folder Doc"; }
  else {
    const m = folderMatch(v.title);
    if (m) { docId = m.id; via = `folder Doc "${m.name}"`; }
  }
  if (!docId) {
    if (post) report.unchanged.push(`${v.title} (no Doc in the folder, left as it is)`);
    else report.skipped.push(`${v.title} (no Doc in the folder yet)`);
    continue;
  }
  claimed.add(docId);
  try {
    const prompt = await getDocText(docId);
    if (post) {
      let next = setField(setPrompt(post.text, prompt), "promptDocId", docId);
      // Re-download Word/PDF only when the prompt changed or the files are missing
      // (PDF bytes can change on every export, which would cause needless updates)
      if (next !== post.text || !filesExist(post.slug) || !/^promptPdf:/m.test(post.text)) {
        const files = await saveFormattedFiles(docId, post.slug);
        next = setField(setField(next, "promptDocx", files.docx), "promptPdf", files.pdf);
      }
      if (next === post.text) { report.unchanged.push(v.title); continue; }
      if (!DRY) fs.writeFileSync(post.file, next);
      report.updated.push(`${v.title} → ${post.slug}.md (${prompt.length} chars + Word/PDF, from ${via})`);
    } else {
      let slug = slugify(v.title), n = 2;
      while (fs.existsSync(path.join(POSTS, slug + ".md"))) slug = `${slugify(v.title)}-${n++}`;
      const files = await saveFormattedFiles(docId, slug);
      const art = await writeArticle({ title: v.title, description: v.description, prompt });
      const text =
        `---\ntitle: ${yamlStr(v.title)}\ndescription: ${yamlStr(art.metaDescription || fallbackDescription(v.description))}\n` +
        `date: ${v.published}\nyoutubeId: ${v.id}\nyoutubeTitle: ${yamlStr(v.title)}\ncategory: ${guessCategory(v.title)}\n` +
        (art.seoTitle ? `seoTitle: ${yamlStr(art.seoTitle)}\n` : "") +
        `autoImported: true\npromptDocId: ${docId}\narticleSource: ${art.source}\narticleHash: ${shortHash(art.body)}\n` +
        `promptDocx: ${files.docx}\npromptPdf: ${files.pdf}\n---\n\n${art.body}\n`;
      if (!DRY) fs.writeFileSync(path.join(POSTS, slug + ".md"), setTools(setPrompt(text, prompt), toolsFromArticle(art.body)));
      report.created.push(`${v.title} → ${slug}.md (prompt from ${via}; article: ${art.note})`);
    }
  } catch (err) {
    report.errors.push(`${v.title}: ${err.message}`);
  }
}

for (const d of folderDocs) if (!claimed.has(d.id)) report["folder docs waiting for a video"].push(d.name);

// Upgrade auto-imported posts whose article is still the formatted description (e.g. Gemini was down)
const articles = DRY ? { written: [], skipped: [] } : await updateArticles({ feed });

for (const [k, list] of Object.entries({ ...report, "articles upgraded": articles.written })) {
  console.log(`\n${k.toUpperCase()} (${list.length})`);
  list.forEach((l) => console.log("  • " + l));
}
if (DRY) console.log("\n(dry run, nothing was written)");
if (report.errors.length) process.exitCode = 1;
