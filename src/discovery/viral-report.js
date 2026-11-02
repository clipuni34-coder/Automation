import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

const number = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("en", { notation: Number(value) >= 1000000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value)) : "—";
const scoreClass = (score) => Number(score) >= 70 ? "strong" : Number(score) >= 45 ? "medium" : "low";

export function buildViralReport(discovery, strategy = {}, generatedAt = new Date().toISOString()) {
  const candidates = [...(discovery?.candidates ?? [])]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 100);
  const clusters = [...(discovery?.topicClusters ?? [])]
    .sort((a, b) => (b.averageOpportunityScore ?? 0) - (a.averageOpportunityScore ?? 0))
    .slice(0, 20);
  const cards = candidates.map((item) => {
    const url = safeUrl(item.sourceUrl);
    const evidence = item.evidence ?? {};
    const metrics = item.metrics ?? {};
    const score = Number(item.score ?? 0);
    const momentum = String(item.momentum ?? "unverified");
    const title = escapeHtml(item.title || "Untitled video");
    const creator = escapeHtml(item.creator || "Creator not identified");
    const link = url ? `<a class="source" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : '<span class="muted">No safe source link</span>';
    const search = escapeHtml([item.title, item.creator, item.platform, item.decision, momentum].join(" ").toLowerCase());
    const velocity = evidence.velocityMeasured ? `${number(evidence.viewsPerHour)} views/hour` : "Velocity not measured";
    const breakout = evidence.breakoutSignal ? '<span class="pill breakout">Breakout candidate</span>' : "";
    const reasons = (item.decisionReasons ?? []).slice(0, 3).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
    return `<article class="card candidate" data-search="${search}">
      <div class="cardtop"><span class="platform">${escapeHtml(item.platform || "unknown platform")}</span><span class="score ${scoreClass(score)}">${Math.round(score)}/100</span></div>
      <h3>${title}</h3><p class="creator">${creator}</p>
      <div class="pills"><span class="pill">${escapeHtml(momentum.replaceAll("_", " "))}</span><span class="pill">${escapeHtml(item.confidence || "low")} confidence</span>${breakout}</div>
      <div class="metrics"><div><b>${number(metrics.views)}</b><small>views</small></div><div><b>${velocity}</b><small>recent growth</small></div><div><b>${number(metrics.likes)}</b><small>likes</small></div></div>
      <details><summary>Why it ranked this way</summary><ul>${reasons || "<li>No decision notes available.</li>"}</ul><p class="muted">Score evidence: recency ${number(item.scoreComponents?.recency)}, engagement ${number(item.scoreComponents?.engagement)}, velocity ${number(item.scoreComponents?.velocity)}, completeness ${number(item.scoreComponents?.completeness)}.</p></details>
      ${link}
    </article>`;
  }).join("\n");
  const topics = clusters.map((item) => `<div class="topic"><div><b>${escapeHtml(item.label)}</b><small>${number(item.candidateCount)} references · ${number(item.distinctCreatorCount)} creators</small></div><span class="pill">${escapeHtml(item.lifecycle || "unknown")}</span><span class="pill">${escapeHtml(item.saturation || "unknown")} saturation</span><strong>${number(item.averageOpportunityScore)}/100</strong></div>`).join("\n");
  const recommendations = (strategy?.recommendations ?? []).slice(0, 5).map((item) =>
    `<li><b>${escapeHtml(item.title || item.topic || "Editorial opportunity")}</b><span>${escapeHtml(item.reason || item.creativeAngle || item.angle || item.format || "Review source evidence before reuse.")}</span></li>`
  ).join("\n");
  const discovered = candidates.length;
  const measured = candidates.filter((item) => item.evidence?.velocityMeasured).length;
  const breakoutCount = candidates.filter((item) => item.evidence?.breakoutSignal).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Viral Discovery Report</title>
<style>
:root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f6fa;background:#10131b}
*{box-sizing:border-box}body{margin:0;padding:22px;max-width:1100px;margin-inline:auto}header{padding:12px 0 22px}h1{font-size:clamp(1.8rem,5vw,3rem);margin:0 0 8px}h2{margin:28px 0 12px;font-size:1.25rem}.muted,small{color:#9da6b7}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.stat,.card,.topic{background:#1a2030;border:1px solid #2c3549;border-radius:14px;padding:14px}.stat b{display:block;font-size:1.5rem}.stat span{font-size:.8rem;color:#9da6b7}.controls{display:flex;gap:10px;margin:18px 0}.controls input{width:100%;padding:13px;border-radius:10px;border:1px solid #3b465d;background:#171d2a;color:white;font-size:1rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:12px}.card h3{font-size:1.05rem;line-height:1.4;margin:12px 0 4px}.cardtop,.pills,.metrics{display:flex;justify-content:space-between;gap:8px;align-items:center}.platform,.creator,small{font-size:.8rem}.score{font-weight:800}.strong{color:#61e6a4}.medium{color:#ffd166}.low{color:#ff9c8f}.pills{justify-content:flex-start;flex-wrap:wrap;margin:10px 0}.pill{border:1px solid #3b465d;border-radius:99px;padding:4px 8px;font-size:.72rem;color:#c7d0df}.breakout{border-color:#61e6a4;color:#61e6a4}.metrics{margin:14px 0}.metrics div{display:flex;flex-direction:column;gap:2px}.metrics b{font-size:.9rem}.metrics small{font-size:.7rem}details{border-top:1px solid #2c3549;padding-top:10px;margin-top:10px;font-size:.85rem}summary{cursor:pointer;color:#c7d0df}li{margin:6px 0}.source{display:inline-block;margin-top:12px;color:#8cc8ff;text-decoration:none}.topic{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0;flex-wrap:wrap}.topic div{flex:1;min-width:160px}.topic small{display:block;margin-top:4px}.topic strong{white-space:nowrap}.recommendations li span{display:block;color:#9da6b7;font-size:.85rem;margin-top:3px}.empty{padding:22px;text-align:center;color:#9da6b7}@media(max-width:500px){body{padding:15px}.summary{grid-template-columns:1fr 1fr}.stat:last-child{grid-column:span 2}.topic{align-items:flex-start}.controls{margin:12px 0}}
</style></head><body>
<header><h1>Viral discovery</h1><p class="muted">Evidence-led source discovery and ranking · Generated ${escapeHtml(generatedAt)}</p></header>
<section class="summary"><div class="stat"><b>${discovered}</b><span>ranked source videos</span></div><div class="stat"><b>${measured}</b><span>with measured view velocity</span></div><div class="stat"><b>${breakoutCount}</b><span>breakout candidates</span></div></section>
<h2>Top topic signals</h2>${topics || '<p class="empty">No topic clusters available yet.</p>'}
<h2>Ranked video references</h2><div class="controls"><input id="filter" type="search" placeholder="Search videos, creators or platforms…" aria-label="Filter ranked videos"></div>
<section class="grid" id="candidates">${cards || '<p class="empty">No discovery candidates yet. Run a discovery scan first.</p>'}</section>
<h2>Editorial recommendations</h2><ul class="recommendations">${recommendations || "<li>No editorial recommendations available yet.</li>"}</ul>
<footer class="muted"><p>Scores are heuristic opportunity rankings, not predictions of virality. Growth velocity requires repeated observations. A reference link is not reuse permission. Confirm rights before sourcing or re-editing.</p></footer>
<script>const input=document.getElementById('filter');input.addEventListener('input',()=>{const q=input.value.toLowerCase();document.querySelectorAll('.candidate').forEach(card=>{card.hidden=!card.dataset.search.includes(q)})});</script>
</body></html>`;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
  const strategyPath = process.env.STRATEGY_STORE_PATH ?? "data/strategy.json";
  const outputPath = resolve(process.env.VIRAL_REPORT_PATH ?? "data/viral-discovery-report.html");
  const discovery = await readJson(discoveryPath, { candidates: [], topicClusters: [] });
  const strategy = await readJson(strategyPath, {});
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildViralReport(discovery, strategy), "utf8");
  console.log(JSON.stringify({ status: "created", outputPath, candidates: discovery.candidates?.length ?? 0, topicClusters: discovery.topicClusters?.length ?? 0 }));
}
