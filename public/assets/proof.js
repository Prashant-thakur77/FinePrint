// Proof: counts, memory jobs and blobs, payment digests, Tatum latencies, eval results.
(() => {
  const { esc, fmt, api, chip, tx, addr } = window.FP;
  const $ = (s) => document.querySelector(s);

  const fig = (v, c, s) => `<div class="fig"><div class="v">${v}</div><div class="c">${c}</div><div class="s">${s}</div></div>`;

  async function proof() {
    const r = await api("/api/proof");
    if (!r.ok || !r.data) {
      const msg = `<div class="state err">The record could not be loaded: ${esc(r.error)}.</div>`;
      ["#counts", "#jobs", "#digests", "#latency"].forEach((s) => ($(s).innerHTML = msg));
      return;
    }
    const d = r.data, L = d.live || {};
    $("#server").innerHTML = addr(d.accounts?.server);
    $("#asof").textContent = fmt.stamp(Date.now());
    const vals = [L.rulingsSealed, L.paidRulings, L.usdcReceived, L.rulingsGraded, L.gradedCorrect, L.refunds].map(Number);
    if (vals.every((v) => !v)) {
      $("#counts").innerHTML = `<div class="ledgerline"><span><b>${fmt.n(L.rulingsSealed)}</b>sealed</span><span><b>${fmt.n(L.paidRulings)}</b>paid</span><span><b>${fmt.usdc(L.usdcReceived)}</b>USDC</span><span><b>${fmt.n(L.rulingsGraded)}</b>graded</span><span><b>${fmt.n(L.refunds)}</b>refunds</span></div>
        <div class="empty" data-stamp="Nothing filed yet" style="border-top:0"><span>The ledger is open and empty. Counts move as rulings are sealed and paid. Source: server ledger, ${fmt.stamp(Date.now())}.</span></div>`;
    } else {
    const correct = L.rulingsGraded ? ` <span class="muted" style="font-size:.4em">of ${fmt.n(L.rulingsGraded)}</span>` : "";
    $("#counts").innerHTML = `<div class="figs three">
      ${fig(fmt.n(L.rulingsSealed), "rulings sealed", "Rulings with memory, paid or previewed")}
      ${fig(fmt.n(L.paidRulings), "paid rulings", "Payments settled on Sui mainnet")}
      ${fig(`${fmt.usdc(L.usdcReceived)}`, "USDC received", "Sum of settled payments")}
      ${fig(fmt.n(L.rulingsGraded), "rulings graded", "Markets that resolved after the ruling")}
      ${fig(fmt.n(L.gradedCorrect) + correct, "graded correct", "HIGH means a dispute was predicted")}
      ${fig(fmt.n(L.refunds), "refunds sent", "Fees returned in USDC")}
    </div>`;
    }

    const jobs = d.memoryJobs || [];
    $("#jobs").innerHTML = jobs.length
      ? `<table class="ledger stack"><thead><tr><th>Kind</th><th>Account</th><th>Namespace</th><th>Status</th><th class="r">Jobs</th></tr></thead><tbody>${jobs.map((j) => `<tr><td data-k="">${esc(j.kind)}</td><td data-k="acct">${esc(j.account)}</td><td data-k="ns">${esc(j.namespace)}</td><td data-k="status">${esc(j.status)}</td><td class="r" data-k="n">${fmt.n(j.n)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty"><span><b>No memory jobs recorded on this server yet.</b></span></div>`;
    const blobs = d.recentBlobs || [];
    $("#blobs").innerHTML = blobs.length
      ? `<div class="label" style="margin-bottom:8px">Latest ${blobs.length} blobs</div><table class="ledger stack"><thead><tr><th>Written</th><th>Kind</th><th>Namespace</th><th>Blob</th></tr></thead><tbody>${blobs.map((b) => `<tr><td data-k="">${fmt.stamp(b.done_at)}</td><td data-k="kind">${esc(b.kind)}</td><td data-k="ns">${esc(b.namespace)}</td><td class="wide">${chip(b.blob_id, b.job_id)}</td></tr>`).join("")}</tbody></table>`
      : "";

    const dg = d.digests || [];
    $("#digests").innerHTML = dg.length
      ? `<div class="scroll-x"><table class="ledger stack"><thead><tr><th>When</th><th>Market</th><th class="r">Amount</th><th>Payer</th><th>Digest</th></tr></thead><tbody>${dg.map((p) => `<tr><td data-k="">${fmt.stamp(p.at)}</td><td data-k="market"><a href="/?m=${encodeURIComponent(p.market)}">${esc(p.market)}</a></td><td class="r" data-k="paid">${fmt.usdc(p.amount)} USDC</td><td>${addr(p.payer)}</td><td>${tx(p.digest)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><span><b>No payments yet.</b> Each one will be listed with its Suiscan link.</span></div>`;

    const lat = (d.latency || []).slice().sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...lat.map((l) => l.p95 || 0));
    $("#latency").innerHTML = lat.length
      ? `<table class="ledger stack"><thead><tr><th>Call</th><th class="r">Calls</th><th class="r">p50</th><th class="r">p95</th><th style="width:30%"><span class="sr-only">Chart</span></th></tr></thead><tbody>${lat.map((l) => `<tr><td class="wide" style="font-weight:500">${esc(l.call)}</td><td class="r" data-k="n">${fmt.n(l.n)}</td><td class="r" data-k="p50">${fmt.n(l.p50)} ms</td><td class="r" data-k="p95">${fmt.n(l.p95)} ms</td>
        <td class="wide" aria-hidden="true"><span style="display:block;position:relative;height:10px;margin-top:4px;background:var(--bg-2)"><span style="position:absolute;left:0;top:0;bottom:0;width:${(l.p95 / max) * 100}%;border-right:2px solid var(--ink)"></span><span style="position:absolute;left:0;top:0;bottom:0;width:${(l.p50 / max) * 100}%;background:var(--ink)"></span></span></td></tr>`).join("")}</tbody></table>
        <p class="small muted mono" style="margin:10px 0 0">Bar: filled to p50, line at p95.</p>`
      : `<div class="empty"><span><b>No Tatum calls timed in the last 7 days.</b></span></div>`;
  }

  // Eval results: free-form JSON, published later. Shown as-is, never guessed.
  async function evals() {
    let data = null;
    try { const r = await fetch("/data/results.json", { cache: "no-store" }); if (r.ok) data = await r.json(); } catch { data = null; }
    if (!data) { $("#eval").innerHTML = `<div class="empty"><span> The evaluation has not been published yet. Numbers appear here when it is.</span></div>`; return; }
    const flat = Object.entries(data).filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v));
    const nested = Object.entries(data).filter(([, v]) => v && typeof v === "object");
    const show = (v) => (typeof v === "number" ? (Number.isInteger(v) ? fmt.n(v) : String(Number(v.toFixed(4)))) : esc(String(v)));
    $("#eval").innerHTML = `${flat.length ? `<table class="ledger"><tbody>${flat.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td class="r">${show(v)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${nested.map(([k, v]) => `<div class="label" style="margin:18px 0 8px">${esc(k)}</div><pre class="code">${esc(JSON.stringify(v, null, 2))}</pre>`).join("")}
      <p class="small muted mono" style="margin:12px 0 0">Source: /data/results.json</p>`;
  }

  proof();
  evals();
})();
