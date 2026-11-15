(() => {
  // Mobile menu
  const toggle = document.querySelector(".nav-toggle");
  const links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", (e) => {
      if (e.target.closest("a")) { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    });
  }

  // Light / dark mode toggle (remembers the choice)
  const root = document.documentElement;
  const themeBtn = document.querySelector(".theme-toggle");
  const syncThemeBtn = () => {
    const light = root.getAttribute("data-theme") === "light";
    themeBtn?.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#faf8f4" : "#0c0b10");
  };
  syncThemeBtn();
  themeBtn?.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    syncThemeBtn();
  });

  // Toast
  let toastEl;
  const toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2000);
  };

  // Copy prompt
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.querySelector(btn.dataset.copy)?.innerText || "";
      try { await navigator.clipboard.writeText(text); }
      catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
      const old = btn.textContent; btn.textContent = "Copied ✓"; toast("Prompt copied to clipboard");
      setTimeout(() => (btn.textContent = old), 1800);
    });
  });

  // Share post (phone share sheet, or copy link on desktop)
  document.querySelectorAll("[data-share]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const data = { title: btn.dataset.title || document.title, url: location.href.split("?")[0] };
      if (navigator.share) { try { await navigator.share(data); } catch (e) {} return; }
      try { await navigator.clipboard.writeText(data.url); toast("Link copied"); } catch (e) { prompt("Copy this link:", data.url); }
    });
  });

  // Contact form: pre-select a service from ?service=ugc (links on the Services cards)
  const svc = new URLSearchParams(location.search).get("service");
  if (svc) {
    const radio = document.querySelector(`.contact-form input[name="service"][data-key="${CSS.escape(svc)}"]`);
    if (radio) radio.checked = true;
  }

  // Download prompt as .txt
  document.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = document.querySelector(btn.dataset.download)?.innerText || "";
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: btn.dataset.filename || "master-prompt.txt" });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    });
  });

  // Expand prompt
  document.querySelectorAll("[data-expand]").forEach((btn) => {
    const body = btn.closest(".prompt-box").querySelector(".prompt-body");
    if (body.scrollHeight <= body.clientHeight + 4) { btn.closest(".prompt-expand").remove(); return; }
    btn.addEventListener("click", () => {
      const ex = body.classList.toggle("expanded");
      btn.textContent = ex ? "Collapse prompt" : "Show full prompt";
    });
  });

  // Click-to-load YouTube (faster pages)
  document.querySelectorAll(".video[data-yt]").forEach((wrap) => {
    wrap.querySelector("button")?.addEventListener("click", () => {
      const f = document.createElement("iframe");
      f.src = `https://www.youtube-nocookie.com/embed/${wrap.dataset.yt}?autoplay=1&rel=0`;
      f.title = "YouTube video"; f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"; f.allowFullscreen = true;
      wrap.innerHTML = ""; wrap.appendChild(f);
    });
  });

  // Blog filters + search
  const grid = document.getElementById("post-grid");
  if (grid) {
    const cards = [...grid.querySelectorAll(".card")];
    const chips = [...document.querySelectorAll("[data-filter]")];
    const search = document.getElementById("search");
    const clear = document.querySelector(".search-clear");
    const empty = document.getElementById("empty");
    const count = document.getElementById("result-count");
    const ytBase = document.getElementById("empty-yt")?.getAttribute("href");
    // Lowercase, drop punctuation/emoji so "FREE (1 MASTER PROMPT)" matches "free master prompt"
    const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
    const stop = new Set(["how", "to", "a", "an", "the", "with", "for", "and", "of", "in", "1"]);
    const index = cards.map((c) => " " + norm(c.dataset.search) + " ");
    const ytId = (s) => (s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1];
    const pager = document.getElementById("pager");
    const pagerInfo = document.getElementById("pager-info");
    const perPage = Math.max(1, parseInt(grid.dataset.pageSize, 10) || 9);
    const params = new URLSearchParams(location.search);
    let cat = "all";
    let page = Math.max(1, parseInt(params.get("page"), 10) || 1);

    // Search + filter across ALL posts, then show only the current page
    const apply = ({ scroll = false } = {}) => {
      const raw = (search?.value || "").trim();
      const id = ytId(raw);
      let words = id ? [norm(id)] : norm(raw).split(" ").filter(Boolean);
      const meaningful = words.filter((w) => !stop.has(w));
      if (meaningful.length) words = meaningful;

      const matches = cards.filter((c, i) => {
        const okCat = cat === "all" || c.dataset.category === cat;
        // every word must appear (prefix match, so "cartoo" finds "cartoon")
        const okText = !words.length || words.every((w) => index[i].includes(" " + w));
        return okCat && okText;
      });
      const pages = Math.max(1, Math.ceil(matches.length / perPage));
      page = Math.min(page, pages);
      const start = (page - 1) * perPage;
      const visible = new Set(matches.slice(start, start + perPage));
      cards.forEach((c) => (c.hidden = !visible.has(c)));

      if (clear) clear.hidden = !raw;
      empty.style.display = matches.length ? "none" : "block";
      document.getElementById("empty-q").textContent = raw || "this filter";
      if (ytBase) document.getElementById("empty-yt").href = ytBase + "?query=" + encodeURIComponent(raw);
      count.textContent = raw || cat !== "all" ? `${matches.length} prompt${matches.length === 1 ? "" : "s"} found` : `${matches.length} prompts`;
      pagerInfo.textContent = pages > 1 ? `Showing ${start + 1}–${start + visible.size} of ${matches.length}` : "";
      renderPager(pages);

      // keep ?q= and ?page= in the URL so it can be shared or linked from a video description
      const url = new URL(location.href);
      raw ? url.searchParams.set("q", raw) : url.searchParams.delete("q");
      page > 1 ? url.searchParams.set("page", page) : url.searchParams.delete("page");
      history.replaceState(null, "", url);
      if (scroll) grid.closest("section").previousElementSibling.querySelector(".filters").scrollIntoView({ behavior: "smooth", block: "start" });
    };

    const pageList = (pages) => {
      if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
      const set = [1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages);
      const sorted = [...new Set(set)].sort((a, b) => a - b);
      const out = [];
      sorted.forEach((n, i) => { if (i && n - sorted[i - 1] > 1) out.push("…"); out.push(n); });
      return out;
    };
    const renderPager = (pages) => {
      pager.hidden = pages <= 1;
      if (pages <= 1) { pager.innerHTML = ""; return; }
      const btn = (label, target, opts = {}) =>
        `<button type="button" data-page="${target}" ${opts.disabled ? "disabled" : ""} ${opts.current ? 'aria-current="page"' : ""} aria-label="${opts.aria || "Page " + target}">${label}</button>`;
      pager.innerHTML =
        btn("← Prev", page - 1, { disabled: page === 1, aria: "Previous page" }) +
        pageList(pages).map((n) => (n === "…" ? "<span>…</span>" : btn(n, n, { current: n === page }))).join("") +
        btn("Next →", page + 1, { disabled: page === pages, aria: "Next page" });
    };
    pager.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-page]");
      if (!b || b.disabled) return;
      page = parseInt(b.dataset.page, 10);
      apply({ scroll: true });
    });

    chips.forEach((ch) => ch.addEventListener("click", (e) => {
      e.preventDefault(); // filter instantly here; the link itself is for search engines and no-JS visitors
      cat = ch.dataset.filter; page = 1;
      chips.forEach((x) => x.setAttribute("aria-pressed", String(x === ch)));
      apply();
    }));
    search?.addEventListener("input", () => { page = 1; apply(); });
    clear?.addEventListener("click", () => { search.value = ""; page = 1; apply(); search.focus(); });
    if (params.get("q") && search) search.value = params.get("q");
    apply();
  }
})();
