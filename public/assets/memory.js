// Memory: case-law counter, changed-its-mind strip, accounts and delegate keys, revoke button.
(() => {
  const { esc, fmt, api, chip, tx, stamp, short } = window.FP;
  const $ = (s) => document.querySelector(s);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
  const obj = (id) => id ? `<a class="chip tx" href="https://suiscan.xyz/mainnet/object/${esc(encodeURIComponent(id))}" target="_blank" rel="noopener" title="Sui object ${esc(id)}">${esc(short(id))}</a>` : '<span class="chip pending">pending</span>';
  const ref = (v) => {
    if (!v) return '<span class="chip pending">pending</span>';
    if (String(v).startsWith("job:")) return chip(null, String(v).slice(4));
    if (UUID.test(v)) return `<span class="chip pending" title="Ruling ${esc(v)} has no Walrus blob yet">ruling ${esc(String(v).slice(0, 8))} · not sealed yet</span>`;
    return chip(v);
  };

  async function stats() {
    const r = await api("/api/memory/stats");
    if (!r.ok || !r.data) {
      const why = r.status === 404 ? "This server does not publish memory stats yet." : `Memory stats could not be loaded: ${esc(r.error)}.`;
      $("#law").innerHTML = `<div class="empty" data-stamp="Count pending"><span>${why} No number is shown until the server reports one.</span></div>
        <div class="ghostwall" aria-hidden="true" style="margin-top:16px">${"<span></span>".repeat(320)}</div>
        <p class="small muted mono" style="margin:8px 0 0">Empty docket. One square fills for each precedent the server counts.</p>`;
      $("#accounts").innerHTML = `<div class="empty"><span>${why}</span></div>`;
      return;
    }
    const d = r.data;
    const law = d.caseLaw ?? d.seeded?.precedents ?? null;
    const total = d.totalMemories ?? null;
    $("#dl-law").textContent = law == null ? "pending" : fmt.n(law);
    $("#dl-all").textContent = total == null ? "pending" : fmt.n(total);
    const cap = 2400;
    const squares = law ? Array.from({ length: Math.min(law, cap) }, () => "<span></span>").join("") : "";
    const ns = Object.entries(d.accounts?.PRECEDENTS?.byNamespace || {});
    $("#law").innerHTML = `<div class="figs three">
        <div class="fig"><div class="v ${law == null ? "pending" : ""}">${law == null ? "pending" : fmt.n(law)}</div><div class="c">precedents the court can cite</div><div class="s">Source: memory stats, PRECEDENTS account</div></div>
        <div class="fig"><div class="v ${total == null ? "pending" : ""}">${total == null ? "pending" : fmt.n(total)}</div><div class="c">memories across all accounts</div><div class="s">Source: memory stats, all accounts</div></div>
        <div class="fig"><div class="v">${d.at ? fmt.time(d.at) : "–"}</div><div class="c">last counted, UTC</div><div class="s">Recounted at most every 5 minutes</div></div>
      </div>
      ${law ? `<div class="wall" aria-label="${fmt.n(law)} precedents" role="img">${squares}</div>${law > cap ? `<p class="small muted mono" style="margin:0">Showing ${fmt.n(cap)} of ${fmt.n(law)}.</p>` : ""}` : `<div class="empty"><span>No precedents counted yet.</span></div>`}
      ${ns.length ? `<div class="tags">${ns.map(([k, v]) => `<span class="tag">${esc(k)} · ${fmt.n(v)}</span>`).join("")}</div>` : ""}`;

    const accs = Object.entries(d.accounts || {});
    $("#accounts").innerHTML = accs.length ? `<div class="scroll-x"><table class="ledger stack"><thead><tr><th>Account</th><th>Object</th><th class="r">Memories</th><th>Delegate keys</th></tr></thead><tbody>${accs.map(([name, a]) => `<tr>
        <td data-k="" style="font-weight:600">${esc(name)}</td><td>${obj(a.accountId)}</td>
        <td class="r" data-k="memories">${a.total == null ? '<span class="muted">pending</span>' : fmt.n(a.total)}</td>
        <td class="wide">${(a.delegates || []).length ? (a.delegates || []).map((k) => `<span class="tag" title="${esc(k)}" style="margin:0 4px 4px 0;display:inline-block">${esc(short(k, 8, 6))}</span>`).join("") : '<span class="muted">none listed</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><span>No accounts reported.</span></div>`;
    if (d.lastRevoke) showRevoke(d.lastRevoke, false);
  }

  async function changes() {
    const r = await api("/api/changes");
    if (!r.ok || !r.data) { $("#changes").innerHTML = `<div class="state err">Could not load changes: ${esc(r.error)}.</div>`; return; }
    const rows = r.data.changes || [];
    if (!rows.length) { $("#changes").innerHTML = `<div class="empty"><span><b>No changes yet.</b> The first one appears when a market the court ruled on resolves and the court rules on a related market again.</span></div>`; return; }
    $("#changes").innerHTML = rows.map((c) => `<article class="change">
      <div class="ch-q"><span class="label">Market ${esc(c.market)} · ${fmt.stamp(c.at)}</span>${esc(c.question || "")}</div>
      <div class="ch-row">
        <div><span class="label">Old ruling</span>${c.old_verdict ? stamp(c.old_verdict, "sm") : ""}<div>${ref(c.old_ruling)}</div></div>
        <div><span class="label">New precedent</span><span>${esc(c.cause || "")}</span><div>${ref(c.cause_blob)}</div></div>
        <div><span class="label">New ruling</span>${c.new_verdict ? stamp(c.new_verdict, "sm") : '<span class="muted small mono">not issued yet</span>'}<div>${c.new_ruling ? ref(c.new_ruling) : ""}</div></div>
      </div></article>`).join("");
  }

  function showRevoke(x, fresh) {
    $("#revoke-out").innerHTML = `<article class="receipt"><div class="r-top"><span>${fresh ? "Delegate key revoked" : "Last revoke"}</span><span>${x.at ? fmt.stamp(x.at) : ""}</span></div>
      <h4>Removal transaction</h4><div>${tx(x.digest)}</div>
      <h4>Key removed</h4><div class="mono small" style="overflow-wrap:anywhere">${esc(x.removedKey || "–")}</div>
      ${x.nextKey ? `<h4>Replacement key</h4><div class="mono small" style="overflow-wrap:anywhere">${esc(x.nextKey)}</div><div style="margin-top:6px">${tx(x.nextDigest)}</div>` : `<h4>Replacement key</h4><div class="small muted">Not added yet. The next press retries.</div>`}
      <div class="r-foot"><span>Account</span>${obj(x.account)}<span>Memories saved before removal stay readable by the old key.</span></div></article>`;
  }

  // Two presses: arm, then send.
  let armed = false, timer = 0;
  $("#revoke").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!armed) {
      armed = true; b.textContent = "Press again to send the transaction";
      clearTimeout(timer); timer = setTimeout(() => { armed = false; b.textContent = "Revoke the guest delegate key"; }, 6000);
      return;
    }
    clearTimeout(timer); armed = false;
    b.disabled = true; b.textContent = "Sending to Sui mainnet…";
    const r = await api("/api/revoke", { method: "POST" });
    b.disabled = false; b.textContent = "Revoke the guest delegate key";
    if (r.ok && r.data?.digest) showRevoke(r.data, true);
    else $("#revoke-out").innerHTML = `<div class="state err"><b>Not revoked.</b> ${esc(r.data?.error || r.error)}${r.status ? ` (HTTP ${r.status})` : ""}</div>`;
  });

  stats();
  changes();
})();
