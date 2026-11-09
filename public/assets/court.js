// Court: live payments ticker, per-pattern price board, refunds, docket, bot snippet.
(() => {
  const { esc, fmt, api, chip, tx, addr, stamp, API } = window.FP;
  const $ = (s) => document.querySelector(s);
  const origin = API || location.origin;
  const seen = new Set();
  let first = true, timer = 0;

  const verdictCell = (v) => (v ? stamp(v, "sm") : '<span class="muted">–</span>');
  const graded = (r) => (r.correct == null ? '<span class="muted">open</span>' : Number(r.correct) ? "correct" : '<span class="yes">wrong</span>');

  function ticker(payments) {
    if (!payments.length) {
      return `<div class="empty" data-stamp="None filed"><span><b>No paid rulings yet.</b> When a bot pays, the payment lands here within 10 seconds, with its Sui digest and the sealed ruling.</span></div>`;
    }
    return `<div class="scroll-x"><table class="ledger stack"><thead><tr><th>When</th><th>Market</th><th>Ruling</th><th class="r">Paid</th><th>Payer</th><th>Payment</th><th>Ruling memory</th><th>Refund</th></tr></thead><tbody>${payments.map((p) => {
      const fresh = !first && !seen.has(p.digest);
      seen.add(p.digest);
      return `<tr class="${fresh ? "fresh" : ""}"><td data-k="">${fmt.stamp(p.at)}</td>
        <td class="q wide">${esc(p.question || `Market ${p.market}`)}</td>
        <td>${verdictCell(p.verdict)}</td>
        <td class="r" data-k="paid">${fmt.usdc(p.amount)} USDC</td>
        <td data-k="from">${addr(p.payer)}</td>
        <td>${tx(p.digest)}</td>
        <td>${p.verdict ? chip(p.blob_id, p.job_id) : '<span class="muted">no ruling</span>'}</td>
        <td>${p.refund_digest ? tx(p.refund_digest) : `<span class="muted">${p.correct == null ? "–" : "none"}</span>`}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function refunds(rows) {
    if (!rows.length) return `<div class="empty"><span><b>No refunds yet.</b> Each refund will show its Sui transaction here.</span></div>`;
    return `<div class="scroll-x"><table class="ledger stack"><thead><tr><th>Graded</th><th>Market</th><th>Ruling</th><th>Outcome</th><th class="r">Fee back</th><th>To</th><th>Refund</th></tr></thead><tbody>${rows.map((r) => `<tr>
      <td data-k="">${fmt.stamp(r.graded_at)}</td><td class="q wide">${esc(r.question || r.market)}</td><td>${verdictCell(r.verdict)}</td>
      <td data-k="outcome">${esc(r.outcome || "–")}${Number(r.disputed) ? ", disputed" : ""}</td><td class="r" data-k="fee">${fmt.usdc(r.price)} USDC</td>
      <td>${addr(r.payer)}</td><td>${tx(r.refund_digest)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function rulings(rows) {
    if (!rows.length) return `<div class="empty"><span><b>No sealed rulings yet.</b></span></div>`;
    return `<div class="scroll-x"><table class="ledger stack"><thead><tr><th>Issued</th><th>Market</th><th>Ruling</th><th class="r">p(dispute)</th><th>Graded</th><th>Memory</th></tr></thead><tbody>${rows.map((r) => `<tr>
      <td data-k="">${fmt.stamp(r.at)}</td><td class="q wide"><a href="/?m=${encodeURIComponent(r.market)}">${esc(r.question)}</a></td><td>${verdictCell(r.verdict)}</td>
      <td class="r" data-k="p">${fmt.pct(r.pDispute)}</td><td data-k="graded">${graded(r)}${r.outcome ? ` · ${esc(r.outcome)}` : ""}</td>
      <td class="wide" style="display:flex;gap:6px;flex-wrap:wrap">${chip(r.blobId, r.jobId)}${r.gradeBlob ? chip(r.gradeBlob) : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }

  async function poll() {
    clearTimeout(timer);
    const live = $("#live");
    const r = await api("/api/court/feed");
    if (r.ok && r.data) {
      $("#ticker").innerHTML = ticker(r.data.payments || []);
      $("#refunds").innerHTML = refunds(r.data.refunds || []);
      $("#rulings").innerHTML = rulings(r.data.rulings || []);
      live.className = "live"; void live.offsetWidth; live.classList.add("tick");
      live.textContent = `Checked ${fmt.time(Date.now())}:${String(new Date().getUTCSeconds()).padStart(2, "0")} UTC`;
      first = false;
    } else {
      live.className = "live off";
      live.textContent = "Feed unreachable";
      if (first) {
        const msg = `<div class="state err">The feed could not be loaded: ${esc(r.error)}. Retrying every 10 seconds.</div>`;
        $("#ticker").innerHTML = msg; $("#refunds").innerHTML = ""; $("#rulings").innerHTML = "";
      }
    }
    if (!document.hidden) timer = setTimeout(poll, 10_000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); else clearTimeout(timer); });

  async function board() {
    const r = await api("/api/board");
    if (!r.ok || !r.data) { $("#board").innerHTML = `<div class="state err">The price board could not be loaded: ${esc(r.error)}.</div>`; return; }
    const { board: rows = [], base } = r.data;
    $("#base").textContent = base != null ? `${fmt.usdc(base)} USDC` : "–";
    const max = Math.max(...rows.map((x) => x.price), 0.05);
    if (rows.length && rows.every((x) => !x.total)) {
      const p = rows[0].price, same = rows.every((x) => x.price === p);
      $("#board").innerHTML = `<table class="ledger"><thead><tr><th>Wording patterns</th><th class="r">Record</th><th class="r">Accuracy</th><th class="r">Price</th></tr></thead><tbody><tr>
        <td>All ${rows.length}</td><td class="r">no grades yet</td><td class="r">${fmt.pct(rows[0].accuracy)}</td><td class="r">${same ? `${fmt.usdc(p)} USDC` : "varies"}</td></tr></tbody></table>
        <div class="tags" style="margin-top:12px">${rows.map((x) => `<span class="tag">${esc(x.pattern)}</span>`).join("")}</div>
        <p class="small muted" style="margin:10px 0 0">Prices start moving when the first rulings are graded.</p>`;
      return;
    }
    $("#board").innerHTML = `<table class="ledger stack"><thead><tr><th>Wording pattern</th><th class="r">Record</th><th class="r">Accuracy</th><th class="r">Price</th></tr></thead><tbody>${rows.map((x) => `<tr>
      <td class="wide" style="font-weight:500">${esc(x.pattern)}</td>
      <td class="r" data-k="record">${x.correct}/${x.total}${x.total ? "" : ' <span class="muted">no grades</span>'}</td>
      <td class="r" data-k="acc">${fmt.pct(x.accuracy)}</td>
      <td class="r" data-k="price"><span style="display:inline-flex;align-items:center;gap:8px"><span aria-hidden="true" style="display:inline-block;height:6px;width:${Math.round((x.price / max) * 60)}px;background:var(--ink)"></span>${fmt.usdc(x.price)} USDC</span></td></tr>`).join("")}</tbody></table>`;
  }

  // Bot snippet
  const market = "2169995";
  $("#pane-curl").innerHTML = esc(`# 1. Ask. The answer is 402 with the price and where to pay.
curl -i "${origin}/api/ruling?market=${market}"

# 2. Sign the USDC payment it asks for, then retry with it.
curl "${origin}/api/ruling?market=${market}" \\
  -H "X-PAYMENT: <signed x402 payment, base64>"

# 200 → { ruling: { verdict, pDispute, cites: [{ blobId, ... }] }, payment: { digest } }`).replace(/^(#.*)$/gm, '<span class="c">$1</span>');
  $("#pane-ts").innerHTML = esc(`import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { buildX402SignedPayment, X402_PAYMENT_HEADER } from "@suimpp/mpp/x402";

const url = "${origin}/api/ruling?market=${market}";
const signer = Ed25519Keypair.fromSecretKey(process.env.SUI_KEY!);

const ask = await fetch(url);                     // 402 Payment Required
const { accepts } = await ask.json();
const { header } = await buildX402SignedPayment({ requirements: accepts[0], signer });

const paid = await fetch(url, { headers: { [X402_PAYMENT_HEADER]: header } });
const { ruling, payment } = await paid.json();
console.log(ruling.verdict, ruling.pDispute, ruling.cites.map((c) => c.blobId), payment.digest);`).replace(/(\s)(\/\/ .*)$/gm, '$1<span class="c">$2</span>');

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (t) => tabs.forEach((b) => { const on = b === t; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; $("#" + b.getAttribute("aria-controls")).hidden = !on; });
  tabs.forEach((b, i) => {
    b.addEventListener("click", () => select(b));
    b.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; select(n); n.focus(); } });
  });

  poll();
  board();
})();
