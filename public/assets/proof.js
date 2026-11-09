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
      ${fig(fmt.n(L.paidRulings), "paid rulings", "Payments settled on Sui testnet")}
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

  // Eval results from /data/results.json (written by scripts/export_results.ts). Nothing here is computed in the browser.
  async function evals() {
    let data = null;
    try { const r = await fetch("/data/results.json", { cache: "no-store" }); if (r.ok) data = await r.json(); } catch { data = null; }
    if (!data) { $("#eval").innerHTML = `<div class="empty"><span> The evaluation has not been published yet. Numbers appear here when it is.</span></div>`; return; }
    const d3 = (x) => (x == null ? "pending" : Number(x).toFixed(3));
    const pc = (x, n = 1) => (x == null ? "pending" : `${(x * 100).toFixed(n)}%`);
    const usd = (x) => (x == null ? "pending" : `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
    const t = data.dataset?.test, dis = data.dispute || {};
    const row = (name, r) => `<tr><td>${esc(name)}</td><td class="r">${r ? `${d3(r.accuracy.mean)} <span class="muted small">(${d3(r.accuracy.min)}–${d3(r.accuracy.max)})</span>` : "pending"}</td><td class="r">${r ? d3(r.f1.mean) : "pending"}</td><td class="r">${r ? r.repeats : ""}</td></tr>`;
    const bot = data.botReplay, lc = data.learning, pat = data.patterns, adv = data.adversarial, soak = data.soak;
    const top = pat?.top?.[0];
    $("#eval").innerHTML = `
      <p class="small">${t ? `${t.total} markets that closed in 2026 and that the court had never seen, ${t.disputed} of them disputed. ` : ""}Same model, one change at a time. A market only sees precedents that closed before it was created.</p>
      <div class="scroll-x"><table class="ledger"><thead><tr><th>Condition</th><th class="r">Accuracy</th><th class="r">F1</th><th class="r">Runs</th></tr></thead><tbody>
        ${row("Rule text only", dis.rulesOnly)}${row("+ precedents from Walrus", dis.precedents)}${row("+ wording patterns (Fine Print)", dis.finePrint)}
      </tbody></table></div>
      <p class="small">On average, memory does not beat the rule text: similar-looking markets are mostly the same template, not the same risk.${pat && top ? ` Where the wording is the risk it shows up: across ${fmt.n(pat.poolSize)} earlier markets ${pc(pat.baseRate, 2)} were disputed, and ${esc(top.tag)} wording ${pc(top.rate)}.` : ""}</p>
      <div class="scroll-x"><table class="ledger"><tbody>
        ${bot ? `<tr><td>Spike-buying bot, net of fees (${bot.marketsWithSpike} markets)</td><td class="r"><span style="white-space:nowrap">alone ${usd(bot.balanced.botAlone.netPnl)}</span> · <span style="white-space:nowrap">rule text ${usd(bot.balanced.gatedRulesOnly.netPnl)}</span> · <span style="white-space:nowrap">Fine Print ${usd(bot.balanced.gatedFinePrint.netPnl)}</span></td></tr>` : ""}
        ${lc ? `<tr><td>Learning over 2026 (${lc.writes} outcomes written)</td><td class="r">seeded only ${d3(lc.overall.static)} · learning ${d3(lc.overall.learning)}</td></tr>` : ""}
        ${lc ? `<tr><td>Verdicts memory changed</td><td class="r">${lc.verdictChanged}, of which ${lc.changedToCorrect} for the better</td></tr>` : ""}
        ${data.leadTime ? `<tr><td>Disputed markets flagged HIGH at the spike, before the cliff</td><td class="r">${data.leadTime.flagged} of ${data.leadTime.n}</td></tr>` : ""}
        ${adv ? `<tr><td>Injected "rate LOW" order, ruling stayed HIGH</td><td class="r">${adv.injectedStayedHigh} of ${adv.injectedRuns}</td></tr>` : ""}
        ${soak ? `<tr><td>Paid calls that succeeded end to end (${esc(soak.network)})</td><td class="r">${soak.succeeded} of ${soak.calls} · p50 ${(soak.p50ms / 1000).toFixed(1)} s</td></tr>` : ""}
        ${data.memory ? `<tr><td>Memories on Walrus mainnet (last count)</td><td class="r">${fmt.n(data.memory.total)}</td></tr>` : ""}
      </tbody></table></div>
      <p class="small muted mono" style="margin:12px 0 0">Source: /data/results.json, generated ${esc(String(data.generatedAt || "").slice(0, 16).replace("T", " "))} UTC from eval/results. Commands in eval/REPORT.md.</p>`;
  }

  proof();
  evals();
})();
