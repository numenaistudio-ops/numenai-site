# NumenAI Studio website

Landing page + master prompt blog, built with Eleventy. Free to host on Netlify.

## Run it on your computer
```
npm install
npm start          # site at http://localhost:8080
```

## Post a new master prompt
**Option A: Dashboard.** Open `/admin`, click **New Master Prompt Post**, fill the form, publish.
(To try the dashboard locally, run `npm run cms` in a second terminal, then open http://localhost:8080/admin.)

**Option B: Ask Claude.** "New post: [YouTube link] + [prompt]".

**Option C: By hand.** Copy any file in `src/blog/posts/`, rename it, and edit the top section:
- `youtubeId`: the part after `watch?v=`
- `category`: Cartoon, Kids, Documentary, Stickman…
- `prompt`: paste your master prompt (keep it indented)
- `tools`: tool names + links (affiliate links welcome)

## Auto-import from YouTube
`npm run sync` reads the channel's latest videos and pulls each video's master prompt into the website
(new videos become new posts; edited Docs update the prompt, Word and PDF files).

**Where the prompt comes from (no link needed in the description):**
1. Put a Google Doc in the master prompt folder (`promptsFolderId` in `src/_data/site.json`).
   The folder is shared "Anyone with the link → Viewer"; Docs inside inherit that.
2. Name the Doc the same as the YouTube title. Small differences are fine (capitals, emojis,
   "(1 Master Prompt)", a missing word). Write it before uploading, so the page is ready when the video goes public.
3. The first time a video matches a Doc, the pairing is saved in the post (`promptDocId`), so renaming
   the video or the Doc later doesn't break it.

The folder is the only source: Google Doc links in video descriptions are ignored. A post with no matching
Doc in the folder is never changed (older posts keep their current prompt until you add a Doc for them).
Shorts and videos with no Doc are skipped, and Docs with no matching video yet are listed as "waiting for a video".
Once the site is on GitHub, `.github/workflows/sync-youtube.yml` runs this every 15 minutes, or press
"Run workflow" on GitHub to run it now.

## Auto-written articles (Gemini, free)
New posts get an article written by Gemini from the video description and master prompt.
1. Create a free API key at https://aistudio.google.com (Get API key).
2. Local: copy `.env.example` to `.env` and paste the key after `GEMINI_API_KEY=`.
   GitHub: Settings → Secrets and variables → Actions → New secret named `GEMINI_API_KEY`.
3. `npm run articles -- --all` upgrades existing posts to AI articles.

Without a key (or if Gemini fails) the post uses your formatted YouTube description instead, and is
upgraded automatically on a later run. Articles you edit yourself are never replaced, and the
"Lock this article" switch in the dashboard blocks rewrites completely. Model: `articleWriter` in site.json.

## Settings
`src/_data/site.json`: site name, domain, YouTube link, email, and `adsenseClient` (paste your `ca-pub-…` ID once AdSense approves you).

## Go live (one-time)
1. Put this folder in a GitHub repo.
2. Netlify → Add new site → Import from GitHub (build settings come from `netlify.toml`).
3. Connect your domain in Netlify.
4. Dashboard login: in `src/admin/config.yml` set `repo:` to your GitHub repo, and enable GitHub OAuth in Netlify (Site configuration → Access & security → OAuth).
5. Newsletter: signups arrive in Netlify → Forms. You can switch to Beehiiv/ConvertKit later.
