// Writes (or upgrades) the blog article under each master prompt.
//
//   npm run articles                      → auto-imported posts that still need an AI article
//   npm run articles -- family-cartoon    → specific posts (by file name, without .md)
//   npm run articles -- --all             → every post that hasn't been edited by you
//   add --dry-run to only see what would happen
//
// Safety rules:
//   • An article you edited yourself is never replaced (detected with articleHash).
//   • articleLocked: true in a post also blocks any rewrite.
//   • A post without an AI article yet (e.g. Gemini was down) is upgraded on a later run.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getField, setField, getPrompt, getBody, setBody, shortHash, yamlStr, getFeed, loadPosts, setTools, toolsFromArticle } from "./lib.mjs";
import { writeArticle } from "./article-writer.mjs";

export async function updateArticles({ only = [], all = false, dry = false, feed } = {}) {
  const posts = loadPosts();
  const videos = new Map((feed || (await getFeed())).map((v) => [v.id, v]));
  const report = { written: [], skipped: [] };

  for (const [id, post] of posts) {
    const { text, slug } = post;
    const source = getField(text, "articleSource");
    const savedHash = getField(text, "articleHash");
    const editedByYou = savedHash && savedHash !== shortHash(getBody(text));
    const named = only.includes(slug);

    if (only.length && !named) continue;
    if (getField(text, "articleLocked") === "true") { report.skipped.push(`${slug}: locked`); continue; }
    if (editedByYou) { report.skipped.push(`${slug}: you edited this article, leaving it alone`); continue; }
    if (source === "ai") { if (named) report.skipped.push(`${slug}: already has an AI article`); continue; }
    if (!source && !named && !all && getField(text, "autoImported") !== "true") continue; // hand-made post: only when asked
    if (source === "description" && !process.env.GEMINI_API_KEY) continue; // nothing better to offer yet

    const video = videos.get(id);
    if (!video?.description) { report.skipped.push(`${slug}: video description not found in the YouTube feed`); continue; }

    const result = await writeArticle({
      title: getField(text, "youtubeTitle") || getField(text, "title"),
      description: video.description,
      prompt: getPrompt(text),
    });
    if (source === "description" && result.source !== "ai") { report.skipped.push(`${slug}: ${result.note}`); continue; }

    let next = setBody(text, result.body);
    next = setTools(next, toolsFromArticle(result.body)); // sidebar matches the article
    next = setField(next, "articleSource", result.source);
    next = setField(next, "articleHash", shortHash(result.body));
    if (result.metaDescription) next = setField(next, "description", yamlStr(result.metaDescription));
    if (result.seoTitle && !getField(text, "seoTitle")) next = setField(next, "seoTitle", yamlStr(result.seoTitle));
    if (!dry) fs.writeFileSync(post.file, next);
    report.written.push(`${slug}: ${result.note}`);
  }
  return report;
}

// Command line
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const report = await updateArticles({
    only: args.filter((a) => !a.startsWith("--")),
    all: args.includes("--all"),
    dry: args.includes("--dry-run"),
  });
  console.log(`\nARTICLES WRITTEN (${report.written.length})`);
  report.written.forEach((l) => console.log("  • " + l));
  console.log(`\nSKIPPED (${report.skipped.length})`);
  report.skipped.forEach((l) => console.log("  • " + l));
  if (!process.env.GEMINI_API_KEY) console.log("\nNote: GEMINI_API_KEY is not set, so articles use the formatted YouTube description.");
  if (args.includes("--dry-run")) console.log("(dry run, nothing was written)");
}
