// Trader view: one market as a case. Exhibit A is the real price chart, with
// ruling pins, rule-version pins and (for the demo replay) the window between
// the warning and the cliff. Every number comes from the API or mstr_story.json.
(() => {
  const { esc, fmt, api, chip, stamp, verdictClass } = window.FP;
  const $ = (s) => document.querySelector(s);
  const DEMO = { from: 1780293600, to: 1780344000 }; // 1 June 2026, 06:00–20:00 UTC
  const DRAW_MS = 1500;

  let story = null, state = null, drawn = false;
  let rulings = { on: null, off: null }, mem = "on", touched = false;

    const params = () => new URLSearchParams(location.search);

  // ---------- Loading ----------
  async function loadStory() {
    if (story) return story;
    try { const r = await fetch("/data/mstr_story.json"); story = r.ok ? await r.json() : null; } catch { story = null; }
    return story;
  }

  async function load() {
    const q = params();
    const ref = (q.get("m") || "").trim();
    const s = await loadStory();
    const demo = !ref || (s && ref === s.market.id && !q.get("from"));
    const id = ref || s?.market.id || "2169995";
    const from = demo ? DEMO.from : Number(q.get("from")) || null;
    const to = demo ? DEMO.to : Number(q.get("to")) || null;
    $("#ref").value = ref;
    drawn = false;
    rulings = { on: null, off: null };
    status("Loading the price record…");
    $("#notes").innerHTML = ""; $("#chart-over").innerHTML = "";
    renderRulings();

    const qs = from && to ? `?from=${from}&to=${to}` : "";
    const res = await api(`/api/market/${encodeURIComponent(id)}${qs}`);
    if (!res.ok) {
      caption(null, ref || id, res);
      status(res.status === 404 ? "No market matches that link or id. Check it and try again." : `The price record could not be loaded (${esc(res.error)}).`);
      $("#honest").hidden = true; $("#src").textContent = "";
      fillRules(null);
      return;
    }
    state = { ...res.data, demo: demo && s && res.data.market.id === s.market.id, window: from && to ? { from, to } : null };
    document.title = `${state.market.question} · Fine Print`;
    caption(state);
    $("#ruling-note").textContent = state.demo ? "The pin on Exhibit A is the replay as of 1 June. Below is today's ruling on the same rules. Flip memory off to see what the rule text alone gives." : "Flip memory off and the judge reads the rule text alone. Leave it on and it reads the case law first.";
    draw();
    fillRules(state);
    fetchRulings(state.market.id);
  }

  // ---------- Caption ----------
  function caption(st, ref, err) {
    const el = $("#caption");
    if (!st) {
      el.innerHTML = `<div><div class="in-re">IN RE</div><h1>${esc(err?.status === 404 ? "No such market" : "Case not loaded")}</h1></div>
        <div class="paren" aria-hidden="true">${")<br>".repeat(2)}</div>
        <dl><dt>Asked for</dt><dd>${esc(ref)}</dd><dt>Answer</dt><dd>${esc(err?.error || "unknown error")}</dd></dl>`;
      return;
    }
    const m = st.market, w = st.window || (st.chart.points.length ? { from: st.chart.points[0].t, to: st.chart.points[st.chart.points.length - 1].t } : null);
    const uma = m.uma?.length ? m.uma.join(" → ") : "none recorded";
    const outcome = m.closed ? `${m.outcome ?? "unknown"}, closed ${fmt.day(m.closedTime)}` : `open${m.endDate ? `, ends ${fmt.day(m.endDate)}` : ""}`;
    const vol = Number.isFinite(m.volume) && m.volume > 0 ? `$${(m.volume / 1e6).toFixed(1)}M` : "–";
    el.innerHTML = `<div><div class="in-re">IN RE${st.demo ? " · REPLAY" : ""}</div><h1>${esc(m.question)}</h1></div>
      <div class="paren" aria-hidden="true">${")<br>".repeat(5)}</div>
      <dl>
        <dt>Market no.</dt><dd>${esc(m.id)}</dd>
        <dt>${st.demo ? "Replay" : "Window"}</dt><dd>${w ? `${fmt.day(w.from)}, ${fmt.time(w.from)}–${fmt.time(w.to)} UTC${fmt.day(w.from) !== fmt.day(w.to) ? ` to ${fmt.day(w.to)}` : ""}` : "–"}</dd>
        <dt>Outcome</dt><dd>${esc(outcome)}</dd>
        <dt>UMA record</dt><dd>${esc(uma)}</dd>
        <dt class="opt">Volume</dt><dd class="opt">${vol}</dd>
      </dl>`;
  }

  // ---------- Chart: a hand-drawn SVG exhibit ----------
  // y is fixed at 0–100c (a price is a probability); x is the time window.
  const PAD = { l: 0, r: 46, t: 14, b: 28 };
  let geo = null, cursor = -1;
  const SVGNS = "http://www.w3.org/2000/svg";

  function status(msg) { const s = $("#chart-status"); s.hidden = !msg; s.innerHTML = msg || ""; }

  function points() {
    const seen = new Set();
    return (state?.chart?.points || []).filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.p)).sort((a, b) => a.t - b.t)
      .filter((p) => (seen.has(p.t) ? false : (seen.add(p.t), true)));
  }

  function measure() {
    const host = $("#chart-host");
    const W = host.clientWidth, H = host.clientHeight, pts = points();
    if (!pts.length || !W) return null;
    const t0 = pts[0].t, t1 = Math.max(pts[pts.length - 1].t, t0 + 60);
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    return { W, H, pts, t0, t1, pw, ph, x: (t) => PAD.l + ((t - t0) / (t1 - t0)) * pw, y: (p) => PAD.t + (1 - p) * ph };
  }

  function ticks(t0, t1, pw) {
    const span = t1 - t0, steps = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600, 2592000];
    const want = Math.max(5, Math.floor(pw / 64));
    const step = steps.find((s) => span / s <= want) || steps[steps.length - 1];
    const out = []; for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
    const daily = step >= 86400;
    return out.map((t) => ({ t, label: daily ? fmt.day(t).replace(/ \d{4}$/, "") : fmt.time(t) }));
  }

  function render(animate) {
    const host = $("#chart-host");
    geo = measure();
    if (!geo) { host.innerHTML = ""; return; }
    const { W, H, pts, x, y, t0, t1, pw } = geo;
    const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.p).toFixed(1)}`).join("");
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(p)}" y2="${y(p)}" class="g${p === 0 ? " base" : ""}"/><text x="${W - PAD.r + 8}" y="${y(p) + 4}" class="yl">${Math.round(p * 100)}c</text>`).join("");
    const xt = ticks(t0, t1, pw).map((k) => `<line x1="${x(k.t)}" x2="${x(k.t)}" y1="${H - PAD.b}" y2="${H - PAD.b + 5}" class="tk"/><text x="${x(k.t)}" y="${H - 8}" class="xl">${k.label}</text>`).join("");
    const last = pts[pts.length - 1];
    host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary())}">
      <g class="axes">${grid}${xt}</g>
      <g class="plot${animate ? " drawing" : ""}"><path d="${d}" class="line"/></g>
      <g class="lastv"><rect x="${W - PAD.r + 2}" y="${y(last.p) - 9}" width="${PAD.r - 2}" height="18"/><text x="${W - PAD.r + 7}" y="${y(last.p) + 4}">${fmt.cents(last.p)}</text></g>
      <g class="cross" hidden><line class="cv" y1="${PAD.t}" y2="${H - PAD.b}"/><circle r="4.5"/><g class="tip"><rect height="22"/><text y="15"></text></g></g>
    </svg>`;
    if (cursor >= 0) showCursor(cursor);
  }

  function summary() {
    const pts = points(); if (!pts.length) return "No price data";
    const lo = Math.min(...pts.map((p) => p.p)), hi = Math.max(...pts.map((p) => p.p));
    return `YES price from ${fmt.stamp(pts[0].t)} to ${fmt.stamp(pts[pts.length - 1].t)}: started at ${fmt.cents(pts[0].p)}, ranged ${fmt.cents(lo)} to ${fmt.cents(hi)}, ended at ${fmt.cents(pts[pts.length - 1].p)}. Use the arrow keys to read prices.`;
  }

  function showCursor(i) {
    if (!geo) return;
    const svg = $("#chart-host svg"); if (!svg) return;
    const p = geo.pts[Math.max(0, Math.min(geo.pts.length - 1, i))];
    const g = svg.querySelector(".cross"); g.hidden = false;
    const cx = geo.x(p.t), cy = geo.y(p.p);
    g.querySelector(".cv").setAttribute("x1", cx); g.querySelector(".cv").setAttribute("x2", cx);
    g.querySelector("circle").setAttribute("cx", cx); g.querySelector("circle").setAttribute("cy", cy);
    const label = `${fmt.time(p.t)} UTC  ${fmt.cents(p.p)}`;
    const tw = label.length * 7.2 + 16;
    const tip = g.querySelector(".tip"); const tx = Math.min(Math.max(cx - tw / 2, 0), geo.W - PAD.r - tw);
    tip.setAttribute("transform", `translate(${tx} ${PAD.t - 12})`);
    tip.querySelector("rect").setAttribute("width", tw);
    tip.querySelector("text").setAttribute("x", 8); tip.querySelector("text").textContent = label;
    $("#chart-live").textContent = label;
  }
  function hideCursor() { cursor = -1; const g = $("#chart-host .cross"); if (g) g.hidden = true; }

  function nearest(px) {
    if (!geo) return -1;
    const t = geo.t0 + ((px - PAD.l) / geo.pw) * (geo.t1 - geo.t0);
    let lo = 0, hi = geo.pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (geo.pts[m].t < t) lo = m; else hi = m; }
    return Math.abs(geo.pts[lo].t - t) < Math.abs(geo.pts[hi].t - t) ? lo : hi;
  }

  function wireChart() {
    const box = $("#chart");
    box.addEventListener("pointermove", (e) => { if (e.target.closest(".card, a")) return; const r = box.getBoundingClientRect(); cursor = nearest(e.clientX - r.left); showCursor(cursor); });
    box.addEventListener("pointerleave", hideCursor);
    box.addEventListener("keydown", (e) => {
      if (!geo) return;
      const step = e.shiftKey ? 60 : 5;
      if (e.key === "ArrowRight") cursor = Math.min(geo.pts.length - 1, (cursor < 0 ? 0 : cursor + step));
      else if (e.key === "ArrowLeft") cursor = Math.max(0, (cursor < 0 ? geo.pts.length - 1 : cursor - step));
      else if (e.key === "Home") cursor = 0; else if (e.key === "End") cursor = geo.pts.length - 1;
      else if (e.key === "Escape") { hideCursor(); return; } else return;
      e.preventDefault(); showCursor(cursor);
    });
    box.addEventListener("blur", hideCursor);
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (state) { render(false); overlay(false); } }); }).observe($("#chart-host"));
  }

  function draw() {
    const pts = points();
    hideCursor();
    if (!pts.length) { $("#chart-host").innerHTML = ""; status("No price history for this window."); notesOnly(); return; }
    status("");
    const animate = !window.FP.reduced();
    render(animate);
    overlay(animate);
    const src = state.chart.source === "tatum" ? "Tatum Prediction Market API" : "Polymarket CLOB price history";
    $("#src").textContent = `Source: ${src}, ${state.chart.interval} candles, ${pts.length} points. YES price, times in UTC. Hover, or focus the chart and use the arrow keys, to read it.`;
    $("#honest").hidden = !state.demo;
    $("#replay").hidden = !animate;
  }

  const xAt = (t) => (geo ? geo.x(Math.max(geo.t0, Math.min(geo.t1, t))) : null);
  const yAt = (p) => (geo ? geo.y(p) : null);
  function priceAt(t) { const pts = points(); let best = null; for (const p of pts) { if (p.t <= t) best = p; else break; } return (best || pts[0])?.p ?? null; }

  // ---------- Pins ----------
  const hm = (dayStartUnix, s) => { const [h, m] = String(s).split(":").map(Number); return dayStartUnix + h * 3600 + m * 60; };
  const dayStart = (t) => t - (t % 86400);

  /** Builds the list of things pinned on the chart. Demo pins are computed from mstr_story.json. */
  function pins() {
    const out = [];
    const pts = points(); if (!pts.length) return out;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const vers = (state.versions || []).slice().sort((a, b) => a.n - b.n);
    const inWin = (t) => t >= t0 && t <= t1;

    if (state.demo && story) {
      const d0 = dayStart(DEMO.from);
      const w = story.window1220;
      const replay = (state.rulings || []).find((r) => (r.asOf && String(r.asOf).startsWith(new Date(d0 * 1000).toISOString().slice(0, 10))) || (r.at >= DEMO.from * 1000 && r.at <= DEMO.to * 1000));
      const twin = story.twin;
      const disputes = (twin.uma || []).filter((u) => u === "disputed").length;
      const times = ["never", "once", "twice", "three times"][disputes] || `${disputes} times`;
      const year = (/(\d{4})\?*$/.exec(twin.question) || [])[1] || fmt.day(twin.closedTime);
      const verdict = replay?.verdict || "HIGH";
      const chips = replay ? [chip(replay.blobId, replay.jobId), ...(replay.cites || []).slice(0, 2).map((c) => chip(c.blobId))] : [chip(null)];
      const tPin = hm(d0, w.from), tCliff = hm(d0, w.to);
      out.push({ kind: verdictClass(verdict), t: tPin, stamp: `Dispute risk ${verdict}`, verdict,
        text: `Same wording in ${year}: disputed ${times}, resolved ${String(twin.outcome).toUpperCase()}.`, when: `${w.from} UTC · replay ruling`, chips, place: "band" });
      out.push({ kind: "band", from: tPin, to: tCliff, label: `2 · ${w.hoursMinutes} at ${Math.round(w.low * 100)}–${Math.round(w.high * 100)}c`,
        text: `${w.hoursMinutes} at ${Math.round(w.low * 100)}–${Math.round(w.high * 100)}c between the warning and the cliff.`, when: `${w.from} → ${w.to} UTC` });
      // One grey pin per rule version posted on-chain during the day (UMA bulletin board).
      const c = story.cliff;
      const lastUpdate = (v) => { const m = String(v.text || "").split(/\n\nUpdate [^:]+: /); return m.length > 1 ? m[m.length - 1].trim() : ""; };
      const later = vers.filter((v) => v.n >= 2 && inWin(Math.floor(v.seen / 1000)));
      if (!later.length) {
        out.push({ kind: "grey", t: tCliff, title: "Rules changed (you bought under v1)", text: `YES went from ${fmt.cents(c.fromPrice)} at ${c.from} to ${fmt.cents(c.toPrice)} at ${c.to}.`, when: `${fmt.time(tCliff)} UTC · rule version`, chips: [chip(null)], place: "right" });
      }
      later.forEach((v, i) => {
        const t = Math.floor(v.seen / 1000);
        const quote = lastUpdate(v);
        const isLast = i === later.length - 1;
        const short = quote.length > 140 ? `${quote.slice(0, 137).replace(/\s+\S*$/, "")}…` : quote;
        out.push({ kind: "grey", t, title: isLast ? `Rules v${v.n} (you bought under v1)` : `Rules v${v.n} · notice`,
          text: isLast ? `“${short}” YES went from ${fmt.cents(c.fromPrice)} at ${c.from} to ${fmt.cents(c.toPrice)} at ${c.to}.` : `“${short}”`,
          when: `${fmt.time(t)} UTC · posted on Polygon`, chips: [chip(v.blob_id, v.job_id)], place: isLast ? "right" : "auto" });
      });
      out.tags = [
        { t: hm(d0, "08:30"), p: story.baselineBefore1145, text: `flat near ${fmt.cents(story.baselineBefore1145)}`, side: "above" },
        { t: hm(d0, story.spike.firstAtOrAbove80c), p: story.spike.price, text: `${fmt.cents(story.spike.price)} by ${story.spike.firstAtOrAbove80c}`, side: "left" },
        { t: hm(d0, story.cliff.to), p: story.cliff.toPrice, text: `${fmt.cents(story.cliff.toPrice)} at ${story.cliff.to}`, side: "right" },
      ];
      return out;
    }

    // Any other market: pin each ruling and each rule version that falls inside the window.
    for (const r of state.rulings || []) {
      const t = Math.floor(r.at / 1000);
      if (!inWin(t)) continue;
      out.push({ kind: verdictClass(r.verdict), t, stamp: `Dispute risk ${r.verdict}`, verdict: r.verdict, text: r.reasons?.[0] || "", when: `${fmt.stamp(r.at)} · ruling`,
        chips: [chip(r.blobId, r.jobId), ...(r.cites || []).slice(0, 2).map((c) => chip(c.blobId))], place: "auto" });
    }
    vers.forEach((v, i) => {
      if (i === 0) return;
      const t = Math.floor(v.seen / 1000);
      if (!inWin(t)) return;
      out.push({ kind: "grey", t, title: `Rules v${v.n} (bought before ${fmt.time(t)}? you bought under v${v.n - 1})`, text: `Rule text changed. Hash ${String(v.hash || "").slice(0, 10)}.`, when: `${fmt.stamp(t)} · rule version`, chips: [chip(v.blob_id, v.job_id)], place: "auto" });
    });
    return out;
  }

  function notesOnly() { renderNotes(state ? pins() : []); }

  function renderNotes(list) {
    const items = list.map((p, i) => {
      const n = i + 1;
      if (p.kind === "band") return `<li><span class="fn bandn">${n}</span><div><span class="when">${esc(p.when)}</span>${esc(p.text)}</div></li>`;
      const head = p.stamp ? `<strong>${esc(p.stamp.toUpperCase())}.</strong> ` : `<strong>${esc(p.title)}.</strong> `;
      return `<li><span class="fn ${p.kind}">${n}</span><div><span class="when">${esc(p.when)}</span>${head}${esc(p.text)}<div class="chips">${(p.chips || []).join("")}</div></div></li>`;
    });
    $("#notes").innerHTML = items.join("") || (state ? `<li><span class="fn grey">–</span><div>Nothing pinned in this window yet. Rulings and rule changes appear here when they happen inside it.</div></li>` : "");
  }

  function overlay(animate) {
    if (!geo || !state) return;
    const over = $("#chart-over");
    const list = pins();
    renderNotes(list);
    const W = over.clientWidth, H = over.clientHeight;
    const axis = PAD.b;
    const paneW = W - PAD.r;
    const delay = (x) => (animate ? Math.max(0, Math.min(1, x / Math.max(paneW, 1))) * DRAW_MS : 0);
    const anim = (x, extra = 0) => (animate ? `animation:pop 260ms var(--ease-settle) ${Math.round(delay(x) + extra)}ms both;` : "");
    let html = "";
    list.forEach((p, i) => {
      const n = i + 1;
      if (p.kind === "band") {
        const x0 = xAt(p.from), x1 = xAt(p.to);
        if (x0 == null || x1 == null) return;
        const dur = Math.max(200, delay(x1) - delay(x0));
        html += `<div class="band" style="left:${x0}px;width:${Math.max(2, x1 - x0)}px;bottom:${axis}px;${animate ? `animation:plot ${dur}ms linear ${Math.round(delay(x0))}ms both;` : ""}">
          <span class="band-label" style="top:10px;bottom:auto;left:50%;transform:translateX(-50%)">${esc(p.label)}</span></div>`;
        return;
      }
      const x = xAt(p.t); if (x == null) return;
      const pr = priceAt(p.t); const y = pr == null ? null : yAt(pr);
      html += `<div class="pinline ${p.kind}" style="left:${x}px;bottom:${axis}px;${anim(x)}"></div>`;
      if (y != null) html += `<div class="pinhead ${p.kind}" style="left:${x}px;top:${y}px;${anim(x)}"></div>`;
      html += `<span class="pinnum ${p.kind}" style="left:${x}px;${anim(x)}">${n}${p.verdict ? ` ${esc(p.verdict)}` : ""}</span>`;
      // Card placement: demo pins have fixed spots chosen so they never cover the line.
      let cardW = Math.min(270, Math.max(200, W * 0.24));
      let left, top;
      if (p.place === "band") { left = x + 12; top = yAt(0.36) ?? H * 0.55; }
      else if (p.place === "right") { const room = paneW - x - 20; if (room >= 180) { cardW = Math.min(cardW, room); left = x + 12; } else left = x - 12 - cardW; top = 30; }
      else { left = x + 12 + cardW > paneW ? x - 12 - cardW : x + 12; top = 14 + (i % 2) * 120; }
      top = Math.max(8, Math.min(top, H - axis - 160));
      const body = p.stamp
        ? `<div class="card-k"><span>${n} · ${esc(p.when)}</span></div><span class="stamp ${p.kind}${animate ? " land" : ""}" style="${animate ? `animation-delay:${Math.round(delay(x) + 120)}ms` : ""}">${esc(p.stamp)}</span><p>${esc(p.text)}</p>`
        : `<div class="card-k"><span>${n} · ${esc(p.when)}</span></div><p><strong>${esc(p.title)}.</strong> ${esc(p.text)}</p>`;
      html += `<div class="card ${p.kind === "grey" ? "" : p.kind}" style="left:${left}px;top:${top}px;width:${cardW}px;${anim(x, 60)}">${body}<div class="chips" style="display:flex;gap:6px;flex-wrap:wrap">${(p.chips || []).join("")}</div></div>`;
    });
    for (const t of list.tags || []) {
      const x = xAt(t.t), y = yAt(t.p); if (x == null || y == null) continue;
      const style = t.side === "left" ? `right:${W - x + 10}px;top:${y - 9}px` : t.side === "right" ? `left:${x + 10}px;top:${y - 22}px` : `left:${x}px;top:${y - 26}px`;
      html += `<span class="note-tag" style="${style};${anim(x)}">${esc(t.text)}</span>`;
    }
    over.innerHTML = html;
    drawn = true;
    // The stamp lands with a small thud on the exhibit.
    const first = list.find((p) => p.stamp);
    if (animate && first) {
      const fx = xAt(first.t);
      setTimeout(() => { const f = $(".exhibit-frame"); f.classList.remove("thud"); void f.offsetWidth; f.classList.add("thud"); }, Math.round(delay(fx) + 120 + 200));
    }
  }

  // ---------- Rulings: memory on vs off ----------
  async function fetchRulings(id) {
    renderRulings();
    const [on, off] = await Promise.all([api(`/api/ruling/free/${encodeURIComponent(id)}`), api(`/api/ruling/free/${encodeURIComponent(id)}?memory=off`)]);
    if (state?.market.id !== id) return;
    rulings.on = on.ok && on.data?.ruling ? { r: on.data.ruling } : { error: on.data?.error || on.error || "no ruling returned", status: on.status };
    rulings.off = off.ok && off.data?.ruling ? { r: off.data.ruling } : { error: off.data?.error || off.error || "no ruling returned", status: off.status };
    if (!touched && rulings.on.error && rulings.off.r) mem = "off";
    renderRulings(true);
    fillRules(state);
  }

  function cell(which) {
    const x = rulings[which];
    const name = which === "on" ? "With case law" : "Rule text only";
    if (!x) return `<div class="${which === mem ? "on" : ""}"><span class="label">${name}</span><div class="cv"><span class="stamp none sm">Pending</span></div><span class="small muted mono">asking the court…</span></div>`;
    if (x.error) return `<div class="${which === mem ? "on" : ""}"><span class="label">${name}</span><div class="cv"><span class="stamp none sm">Pending</span></div><span class="small muted mono">not available right now</span></div>`;
    return `<div class="${which === mem ? "on" : ""}"><span class="label">${name}</span><div class="cv">${stamp(x.r.verdict, "sm")}<span class="num">${fmt.pct(x.r.pDispute)}</span></div><span class="small muted mono">chance of a dispute · ${(x.r.cites || []).length} cited</span></div>`;
  }

  function renderRulings(fresh) {
    document.querySelectorAll("[data-mem]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.mem === mem));
      const na = Boolean(rulings[b.dataset.mem]?.error);
      b.classList.toggle("na", na);
      b.lastChild.textContent = (b.dataset.mem === "on" ? "Memory on" : "Memory off") + (na ? " · unavailable" : "");
    });
    $("#compare").innerHTML = cell("off") + cell("on");
    const x = rulings[mem];
    const box = $("#receipt");
    if (!x) { box.innerHTML = `<div class="state">Asking the court for a ruling${mem === "on" ? " with memory" : " from the rule text alone"}…</div>`; return; }
    if (x.error) {
      box.innerHTML = `<div class="state"><b>No ruling ${mem === "on" ? "with case law" : "from the rule text"} right now.</b> The server said "${esc(x.error)}"${x.status ? ` (HTTP ${x.status})` : ""}. Nothing is shown in its place.</div>`;
      return;
    }
    box.innerHTML = receipt(x.r, fresh && !window.FP.reduced());
  }

  function receipt(r, animate) {
    const memOff = r.level === "rules";
    const cites = r.cites || [];
    const citeBlock = memOff
      ? `<div class="redacted${animate ? " wipe" : ""}" aria-hidden="true"><span></span><span></span><span></span></div><div class="redacted-note">Memory off: no precedents were read</div>`
      : cites.length
        ? `<div class="scroll-x"><table class="cites"><thead><tr><th>Market</th><th>Closed</th><th>Disputed</th><th>Memory</th></tr></thead><tbody>${cites.map((c) => `<tr><td>${c.market ? esc(c.market) : "pattern"}</td><td>${c.closed ? fmt.day(c.closed) : "–"}</td><td>${c.disputed == null ? "–" : c.disputed ? '<span class="yes">yes</span>' : '<span class="no">no</span>'}</td><td>${chip(c.blobId)}</td></tr>${c.text ? `<tr><td colspan="4" class="txt">${esc(c.text.slice(0, 240))}${c.text.length > 240 ? "…" : ""}</td></tr>` : ""}`).join("")}</tbody></table></div>`
        : `<div class="state">No precedents cited.</div>`;
    const seal = memOff ? `<span>Not sealed: memory-off previews are only for comparison.</span>` : `<span>Sealed on Walrus</span>${chip(r.blobId, r.jobId)}`;
    return `<article class="receipt" aria-label="Ruling receipt">
      <div class="r-top"><span>Ruling · ${memOff ? "rule text only" : "with case law"}</span><span>No. ${esc(String(r.id).slice(0, 8))}</span></div>
      <div class="r-verdict"><span class="stamp big ${verdictClass(r.verdict)}${animate ? " land" : ""}">${esc(r.verdict)} risk</span>
        <div class="p num">${fmt.pct(r.pDispute)}<small>chance of a dispute</small></div></div>
      ${r.clause ? `<h4>Riskiest clause</h4><blockquote>${esc(r.clause)}</blockquote>` : ""}
      ${(r.reasons || []).length ? `<h4>Reasons</h4><ol>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : ""}
      <h4>Cited precedents</h4>${citeBlock}
      <div class="r-foot">${seal}<span>Issued ${fmt.stamp(r.at)}</span>${r.cached ? "<span>Cached copy (under 30 min old)</span>" : ""}${r.precedentsConsidered ? `<span>${r.precedentsConsidered} precedents read</span>` : ""}</div>
    </article>`;
  }

  // ---------- Rules text, versions, docket ----------
  function fillRules(st) {
    if (!st) { $("#tags").innerHTML = ""; $("#rules-text").textContent = "–"; $("#versions").innerHTML = ""; $("#docket").innerHTML = ""; return; }
    const m = st.market;
    $("#tags").innerHTML = (st.patterns || []).map((p) => `<span class="tag">${esc(p)}</span>`).join("") || `<span class="small muted">No known risky wording patterns found.</span>`;
    const clause = (rulings.on?.r?.clause || rulings.off?.r?.clause || "").trim();
    let text = esc(m.rules || "No rule text found.");
    if (clause && m.rules?.includes(clause)) text = text.replace(esc(clause), `<mark>${esc(clause)}</mark>`);
    $("#rules-text").innerHTML = text;
    const vs = (st.versions || []).slice().sort((a, b) => a.n - b.n);
    $("#versions").innerHTML = vs.length
      ? `<table class="ledger stack"><thead><tr><th>Version</th><th>First seen</th><th>Hash</th><th>Source</th><th>Memory</th></tr></thead><tbody>${vs.map((v) => `<tr><td data-k="">v${esc(v.n)}</td><td data-k="seen">${fmt.stamp(v.seen)}</td><td data-k="hash">${esc(String(v.hash || "").slice(0, 12))}</td><td data-k="from">${esc(v.source || "–")}</td><td class="wide">${chip(v.blob_id, v.job_id)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty" data-stamp="None filed"><span>No rule versions recorded for this market yet. Versions are saved when the rule text is first read and each time it changes.</span></div>`;
    const rs = st.rulings || [];
    $("#docket").innerHTML = rs.length
      ? `<table class="ledger stack"><thead><tr><th>Issued</th><th>Verdict</th><th class="r">p(dispute)</th><th>Paid</th><th>Memory</th></tr></thead><tbody>${rs.map((r) => `<tr><td data-k="">${fmt.stamp(r.at)}</td><td>${stamp(r.verdict, "sm")}</td><td class="r" data-k="p">${fmt.pct(r.pDispute)}</td><td data-k="paid">${r.sale ? `${fmt.usdc(r.sale.price)} USDC` : "preview"}</td><td class="wide">${chip(r.blobId, r.jobId)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty"><span>No rulings on this market yet.</span></div>`;
  }

  // ---------- Wiring ----------
  $("#file").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#ref").value.trim();
    const u = new URL(location.href);
    u.searchParams.delete("from"); u.searchParams.delete("to");
    if (v) u.searchParams.set("m", v); else u.searchParams.delete("m");
    history.pushState(null, "", u);
    load();
  });
  document.querySelector("[data-demo]").addEventListener("click", () => {
    const u = new URL(location.href); ["m", "from", "to"].forEach((k) => u.searchParams.delete(k));
    history.pushState(null, "", u); load();
  });
  document.querySelectorAll("[data-mem]").forEach((b) => b.addEventListener("click", async () => {
    mem = b.dataset.mem; touched = true;
    // Pressing an unavailable side asks the court again instead of showing a stale error.
    if (rulings[mem]?.error && state) {
      const which = mem, id = state.market.id;
      rulings[which] = null; renderRulings();
      const r = await api(`/api/ruling/free/${encodeURIComponent(id)}${which === "off" ? "?memory=off" : ""}`);
      if (state?.market.id !== id) return;
      rulings[which] = r.ok && r.data?.ruling ? { r: r.data.ruling } : { error: r.data?.error || r.error || "no ruling returned", status: r.status };
      fillRules(state);
    }
    renderRulings(true);
  }));
  addEventListener("popstate", load);
  $("#replay").addEventListener("click", () => { if (state) draw(); });
  addEventListener("keydown", (e) => {
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); $("#ref").focus(); }
  });
  wireChart();
  load();
})();
