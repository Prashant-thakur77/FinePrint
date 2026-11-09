/**
 * Draws the time-machine learning curve from eval/results/learning_curve.json
 * as a static SVG for the README and blog (docs/learning-curve.svg), plus a
 * markdown table with the same numbers (docs/learning-curve.md).
 * Two series on one axis: accuracy per replayed month for the court with only
 * seeded precedents vs the court that kept writing outcomes to Walrus.
 * Colours validated with the dataviz validator against the page surface
 * #f3eee4 (orange is under 3:1, so both lines carry direct labels and the
 * table ships with the chart).
 *
 *   npx tsx scripts/plot_learning.ts
 */
import { writeFileSync } from "node:fs";
import { readJson, RESULTS } from "../eval/lib.js";

const lc = readJson<any>(new URL("learning_curve.json", RESULTS), null);
if (!lc) throw new Error("run eval/learning_curve.ts first");
const rows: { month: string; n: number; staticAccuracy: number; learningAccuracy: number; learnedPrecedentsAvailable: number }[] = lc.perMonth.filter((m: any) => m.n > 0);

const W = 760, H = 380, m = { l: 56, r: 128, t: 56, b: 52 };
const pw = W - m.l - m.r, ph = H - m.t - m.b;
const x = (i: number) => m.l + (rows.length === 1 ? pw / 2 : (i / (rows.length - 1)) * pw);
const y = (v: number) => m.t + (1 - v) * ph;
const C = { surface: "#f3eee4", ink: "#14110f", ink2: "#4a443d", ink3: "#8a8277", grid: "#d6cdbc", s1: "#2a78d6", s2: "#eb6834" };
const line = (k: "staticAccuracy" | "learningAccuracy") => rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
const dots = (k: "staticAccuracy" | "learningAccuracy", c: string) => rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r[k]).toFixed(1)}" r="4" fill="${c}" stroke="${C.surface}" stroke-width="2"><title>${r.month}: ${r[k].toFixed(3)} (${r.n} markets)</title></circle>`).join("");
const last = rows.length - 1;
const ly1 = y(rows[last].staticAccuracy), ly2 = y(rows[last].learningAccuracy);
const [la, lb] = Math.abs(ly1 - ly2) < 16 ? (ly1 < ly2 ? [ly1 - 8, ly2 + 8] : [ly1 + 8, ly2 - 8]) : [ly1, ly2];
const font = `font-family="JetBrains Mono, ui-monospace, monospace"`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Accuracy per replayed month: seeded precedents only vs learning from outcomes</title>
<desc id="d">${rows.map((r) => `${r.month}: static ${r.staticAccuracy.toFixed(3)}, learning ${r.learningAccuracy.toFixed(3)}, ${r.n} markets`).join("; ")}</desc>
<rect width="${W}" height="${H}" fill="${C.surface}"/>
<text x="${m.l}" y="26" ${font} font-size="13" fill="${C.ink}">Dispute-prediction accuracy per replayed month, 2026</text>
<text x="${m.l}" y="44" ${font} font-size="11" fill="${C.ink3}">Same model, same moment for each market. Overall: static ${lc.overall.static.toFixed(3)}, learning ${lc.overall.learning.toFixed(3)} (${lc.writes} outcomes written to Walrus)</text>
${[0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${m.l}" x2="${m.l + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}" stroke-width="1" ${v === 0.5 ? 'stroke-dasharray="4 4"' : ""}/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" ${font} font-size="11" fill="${C.ink3}">${v.toFixed(2)}</text>`).join("\n")}
<text x="${m.l + 4}" y="${y(0.5) - 6}" ${font} font-size="10" fill="${C.ink3}">chance</text>
${rows.map((r, i) => `<text x="${x(i)}" y="${H - m.b + 18}" text-anchor="middle" ${font} font-size="11" fill="${C.ink3}">${r.month.slice(5)}</text><text x="${x(i)}" y="${H - m.b + 32}" text-anchor="middle" ${font} font-size="9" fill="${C.ink3}">n=${r.n}</text>`).join("\n")}
<path d="${line("staticAccuracy")}" fill="none" stroke="${C.s1}" stroke-width="2"/>
<path d="${line("learningAccuracy")}" fill="none" stroke="${C.s2}" stroke-width="2"/>
${dots("staticAccuracy", C.s1)}
${dots("learningAccuracy", C.s2)}
<text x="${x(last) + 10}" y="${la + 4}" ${font} font-size="11" fill="${C.ink2}">seeded only</text>
<text x="${x(last) + 10}" y="${lb + 4}" ${font} font-size="11" fill="${C.ink2}">learning</text>
<g transform="translate(${m.l + pw - 230},${m.t - 4})"><rect x="0" y="-6" width="10" height="2" fill="${C.s1}"/><text x="16" y="0" ${font} font-size="10" fill="${C.ink2}">seeded precedents only</text><rect x="0" y="10" width="10" height="2" fill="${C.s2}"/><text x="16" y="16" ${font} font-size="10" fill="${C.ink2}">+ outcomes learned in the replay</text></g>
</svg>
`;
writeFileSync(new URL("../docs/learning-curve.svg", import.meta.url), svg);
const table = ["| Month ruled | Markets | Seeded only | Learning | Learned precedents available |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.month} | ${r.n} | ${r.staticAccuracy.toFixed(3)} | ${r.learningAccuracy.toFixed(3)} | ${r.learnedPrecedentsAvailable} |`)].join("\n");
writeFileSync(new URL("../docs/learning-curve.md", import.meta.url), `${table}\n\nSource: \`${lc.command}\` → eval/results/learning_curve.json, drawn by \`npx tsx scripts/plot_learning.ts\`.\n`);
console.log("wrote docs/learning-curve.svg and docs/learning-curve.md");
