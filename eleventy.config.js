import fs from "node:fs";
import path from "node:path";

export default function (eleventyConfig) {
  // Static files copied as-is
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/admin");

  // Blog posts collection, newest first
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/blog/posts/*.md").sort((a, b) => b.date - a.date)
  );

  // Unique list of categories used by posts
  eleventyConfig.addCollection("categories", (api) => {
    const set = new Set();
    api.getFilteredByGlob("src/blog/posts/*.md").forEach((p) => p.data.category && set.add(p.data.category));
    return [...set].sort();
  });

  eleventyConfig.addFilter("readableDate", (d) =>
    new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
  );
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("byCategory", (posts, cat) => (posts || []).filter((p) => p.data.category === cat));
  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter("slug", (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
  eleventyConfig.addFilter("readingTime", (content) => {
    const words = String(content || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220)) + " min read";
  });
  eleventyConfig.addFilter("related", (posts, current) =>
    (posts || []).filter((p) => p.url !== current).slice(0, 3)
  );
  // "/assets/prompts/x.pdf" → "126 KB" (reads the file from src/)
  eleventyConfig.addFilter("fileSize", (url) => {
    try {
      const bytes = fs.statSync(path.join("src", url)).size;
      return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
    } catch { return "download"; }
  });
  eleventyConfig.addFilter("thumb", (data) =>
    data.thumbnail ? data.thumbnail : `https://i.ytimg.com/vi/${data.youtubeId}/hqdefault.jpg`
  );

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
