// Shared masthead and footer, plus small helpers for memory chips and receipts.
(() => {
  const pages = [["/", "Trader"], ["/court", "Court"], ["/memory", "Memory"], ["/proof", "Proof"], ["/how", "How it works"]];
  const here = location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const mast = document.querySelector("[data-mast]");
  if (mast) mast.outerHTML = `<header class="mast"><div class="wrap"><a class="brand" href="/">Fine Print<i>.</i></a><nav class="nav">${pages.map(([h, l]) => `<a href="${h}"${h === here ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav></div></header>`;
  const foot = document.querySelector("[data-foot]");
  if (foot) foot.outerHTML = `<footer class="foot"><div class="wrap">Fine Print gives risk opinions, not financial advice. Memory on Walrus mainnet, data and payments through Tatum and Sui. <a href="/security">Security</a> · <a href="/privacy">Privacy</a></div></footer>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const short = (s) => (s && s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);
  window.FP = {
    esc, short,
    chip: (blobId, state = "done") => blobId
      ? `<a class="chip ${state}" href="https://walruscan.com/mainnet/blob/${esc(blobId)}" target="_blank" rel="noopener" title="${esc(blobId)}">${esc(short(blobId))}</a>`
      : `<span class="chip pending">pending</span>`,
    tx: (digest) => `<a class="chip done" href="https://suiscan.xyz/mainnet/tx/${esc(digest)}" target="_blank" rel="noopener" title="${esc(digest)}">${esc(short(digest))}</a>`,
    json: (url, opts) => fetch(url, opts).then((r) => r.json()),
  };
})();
