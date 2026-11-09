// Shared masthead, footer, pleading line numbers and small helpers (window.FP).
(() => {
  const root = document.documentElement;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  };

  // API base: relative by default. For local work: ?api=https://fineprint.prashantthakur.dev (remembered per tab).
  let API = window.FP_API || "";
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q !== null) sessionStorage.setItem("fp-api", q);
    API = sessionStorage.getItem("fp-api") || API;
  } catch { /* storage blocked */ }
  API = API.replace(/\/$/, "");

  const pages = [["/", "Trader"], ["/court", "Court"], ["/memory", "Memory"], ["/proof", "Proof"], ["/how", "How it works"]];
  const here = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/$/, "$1") || "/";

  const mast = document.querySelector("[data-mast]");
  if (mast) {
    mast.outerHTML = `<a class="skip" href="#main">Skip to content</a><header class="mast"><div class="page">
      <a class="brand" href="/" aria-label="Fine Print, home">Fine Print<i>.</i></a>
      <nav class="nav" aria-label="Pages">${pages.map(([h, l]) => `<a href="${h}"${h === here ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <button class="theme" type="button" data-theme-toggle></button>
    </div></header>`;
  }
  const foot = document.querySelector("[data-foot]");
  if (foot) {
    foot.outerHTML = `<footer class="foot"><div class="page">
      <p class="mark">Fine Print<i>.</i></p>
      <p class="terms"><b>The fine print.</b> Fine Print gives risk opinions, not financial advice. A ruling says how likely a market is to be disputed, not how it will resolve. Precedents and rulings are stored on Walrus mainnet; market data and payment checks go through Tatum; payments are USDC on Sui mainnet. Every number on this site comes from the server or a published data file. Anything not measured yet says pending. Replays use only precedents whose market closed before the replay time. A paid LOW ruling that is followed by a dispute is refunded in USDC, and the refund is public.</p>
      <nav aria-label="About"><a href="/how">How it works</a><a href="/security">Security</a><a href="/privacy">Privacy</a></nav>
    </div></footer>`;
  }

  // Theme toggle: follows the system until the visitor picks one.
  const btn = document.querySelector("[data-theme-toggle]");
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const label = () => { if (btn) { btn.textContent = isDark() ? "Light" : "Dark"; btn.setAttribute("aria-label", `Switch to ${isDark() ? "light" : "dark"} theme`); } };
  btn?.addEventListener("click", () => { root.dataset.theme = isDark() ? "light" : "dark"; store.set("fp-theme", root.dataset.theme); label(); dispatchEvent(new Event("fp-theme")); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { label(); dispatchEvent(new Event("fp-theme")); });
  label();

  // Pleading paper: line numbers down the left margin.
  const main = document.querySelector("main.page");
  if (main) {
    main.id = main.id || "main";
    const col = document.createElement("div");
    col.className = "lines"; col.setAttribute("aria-hidden", "true");
    main.prepend(col);
    let n = 0;
    const fill = () => {
      const want = Math.floor(main.offsetHeight / 28);
      if (want === n) return;
      n = want; col.innerHTML = Array.from({ length: want }, (_, i) => `<span>${i + 1}</span>`).join("");
    };
    if ("ResizeObserver" in window) new ResizeObserver(fill).observe(main); else fill();
  }

  // Reveal once on scroll. Content is visible without JS and under reduced motion.
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" }) : null;
  const reveal = (scope = document) => scope.querySelectorAll(".rise:not(.in)").forEach((el) => io ? io.observe(el) : el.classList.add("in"));
  reveal();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const short = (s, a = 6, b = 6) => (s && s.length > a + b + 2 ? `${s.slice(0, a)}…${s.slice(-b)}` : s ?? "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const toDate = (t) => (t instanceof Date ? t : new Date(typeof t === "number" && t < 1e12 ? t * 1000 : t));
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = {
    cents: (p) => (p == null || !isFinite(p) ? "–" : p * 100 < 1 && p > 0 ? `${(p * 100).toFixed(1)}c` : `${Math.round(p * 100)}c`),
    pct: (p, d = 0) => (p == null || !isFinite(p) ? "–" : `${(p * 100).toFixed(d)}%`),
    usdc: (v) => (v == null || !isFinite(Number(v)) ? "–" : `${Number(v).toFixed(Number(v) < 1 ? 3 : 2)}`),
    day: (t) => { if (t == null || t === "") return "–"; const d = toDate(t); return isNaN(d) ? "–" : `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`; },
    time: (t) => { const d = toDate(t); return isNaN(d) ? "–" : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; },
    stamp: (t) => { const d = toDate(t); return isNaN(d) ? "–" : `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`; },
    ago: (t) => { const s = Math.round((Date.now() - toDate(t).getTime()) / 1000); if (!isFinite(s)) return "–"; if (s < 60) return `${Math.max(s, 0)}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; },
    n: (v) => (v == null || !isFinite(Number(v)) ? "–" : Number(v).toLocaleString("en-US")),
  };

  async function api(path, opts) {
    try {
      const r = await fetch(API + path, opts);
      let data = null;
      const text = await r.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      const error = !r.ok ? (data && data.error) || (r.status === 404 ? "not available yet" : `HTTP ${r.status}`) : null;
      return { ok: r.ok, status: r.status, data, error };
    } catch (err) {
      return { ok: false, status: 0, data: null, error: "network error: the server could not be reached" };
    }
  }

  const verdictClass = (v) => (/^(HIGH|MED|LOW)$/.test(v || "") ? v.toLowerCase() : "none");

  window.FP = {
    API, esc, short, fmt, api, store, reveal, verdictClass,
    reduced: () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    walrus: (id) => `https://walruscan.com/mainnet/blob/${encodeURIComponent(id)}`,
    suiscan: (d) => `https://suiscan.xyz/mainnet/tx/${encodeURIComponent(d)}`,
    /** One Walrus blob, always a link. Without a blob id: a pending chip (job id shown if known). */
    chip: (blobId, jobId) => blobId
      ? `<a class="chip" href="https://walruscan.com/mainnet/blob/${esc(encodeURIComponent(blobId))}" target="_blank" rel="noopener" title="Walrus blob ${esc(blobId)}"><span class="k">blob</span>${esc(short(blobId))}</a>`
      : `<span class="chip pending" title="${jobId ? `Memory job ${esc(jobId)} is still being written to Walrus` : "No blob yet"}">${jobId ? `<span class="k">job</span>${esc(short(jobId, 4, 4))} · pending` : "blob pending"}</span>`,
    tx: (digest) => digest
      ? `<a class="chip tx" href="https://suiscan.xyz/mainnet/tx/${esc(encodeURIComponent(digest))}" target="_blank" rel="noopener" title="Sui transaction ${esc(digest)}"><span class="k">tx</span>${esc(short(digest))}</a>`
      : `<span class="chip pending">pending</span>`,
    addr: (a) => a
      ? `<a class="chip tx" href="https://suiscan.xyz/mainnet/account/${esc(encodeURIComponent(a))}" target="_blank" rel="noopener" title="Sui address ${esc(a)}">${esc(short(a))}</a>`
      : "–",
    stamp: (v, size = "") => `<span class="stamp ${size} ${verdictClass(v)}">${v ? esc(v) : "Pending"}</span>`,
  };
})();
