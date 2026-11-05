import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "./config/env.js";
import { auditCredentials } from "./config/credentials.js";
import { validateChannels } from "./config/channels.js";

const config = loadConfig();

const platforms = [
  { id: "youtube", name: "YouTube", status: "not_configured" },
  { id: "instagram", name: "Instagram", status: "not_configured" },
  { id: "tiktok", name: "TikTok", status: "not_configured" }
];

const PIPELINE_STAGES = ["Discovery", "Source verification", "Rights approval", "Story analysis", "Clip selection", "Editing", "Rendering", "Quality control", "Posting package", "Private YouTube upload", "Analytics feedback"];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

export async function getSystemStatus(env = process.env) {
  const credentials = auditCredentials(env).capabilities;
  let channels = [];
  let channelConfigError = null;
  try {
    const raw = await readFile(env.CHANNEL_PROFILES_PATH ?? "config/channels.json", "utf8");
    channels = validateChannels(JSON.parse(raw), env).map((c) => ({
      id: c.id, name: c.name, status: c.status, niche: c.niche,
      publishingEnabled: c.publishing.enabled, privacyStatus: c.publishing.privacyStatus,
      publicBlocked: c.publishing.publicBlocked
    }));
  } catch (error) {
    channelConfigError = error.code === "ENOENT" ? "No channel profiles configured yet (config/channels.json missing)" : error.message;
  }
  return {
    ok: true, service: "social-media-automation", environment: config.nodeEnv,
    approvalRequired: config.requirePublishApproval,
    publicPublishingEnabled: false,
    capabilities: credentials, channels, channelConfigError,
    pipelineStages: PIPELINE_STAGES
  };
}

const MOBILE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Automation Control</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0b0f14;color:#e8eef4;padding:16px;padding-top:max(16px,env(safe-area-inset-top))}
h1{font-size:22px;margin:4px 0 2px}.sub{color:#8fa3b0;font-size:13px;margin-bottom:16px}
.card{background:#131a21;border:1px solid #22303c;border-radius:14px;padding:14px;margin-bottom:12px}
.card h2{font-size:15px;margin:0 0 8px}.row{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid #1d2933;font-size:14px}
.row:first-of-type{border-top:0}.ok{color:#4ade80}.bad{color:#f87171}.warn{color:#fbbf24}.pill{font-size:12px;padding:2px 8px;border-radius:99px;background:#1d2933}
button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:600;background:#2563eb;color:#fff;margin-top:8px}
button:disabled{background:#334155;color:#94a3b8}input{width:100%;padding:12px;border-radius:10px;border:1px solid #2a3a47;background:#0b0f14;color:#fff;font-size:16px;margin-top:8px}
.small{font-size:12px;color:#8fa3b0;line-height:1.5}.stage{display:inline-block;margin:2px;padding:4px 8px;border-radius:99px;background:#1d2933;font-size:12px}
</style></head><body>
<h1>🎬 Automation Control</h1><div class="sub">YouTube Shorts pipeline · public publishing is OFF</div>
<div class="card"><h2>System</h2><div id="sys">Loading…</div></div>
<div class="card"><h2>Capabilities (credential names only)</h2><div id="caps">Loading…</div></div>
<div class="card"><h2>Channels</h2><div id="channels">Loading…</div></div>
<div class="card"><h2>Pipeline</h2><div id="stages"></div></div>
<div class="card"><h2>Record human approval</h2>
<div class="small">Recording approval never publishes anything. Upload still requires credentials, channel-identity match, QC pass and private privacy.</div>
<input id="pkg" placeholder="Package / video ID" autocomplete="off">
<button id="approve">✅ Approve package</button>
<button id="reject" style="background:#7f1d1d">⛔ Reject package</button>
<div class="small" id="msg"></div></div>
<script>
const el=id=>document.getElementById(id);
async function load(){try{const s=await (await fetch('/api/status')).json();
el('sys').innerHTML='<div class="row"><span>Environment</span><b>'+s.environment+'</b></div><div class="row"><span>Approval required</span><b>'+(s.approvalRequired?'Yes':'No')+'</b></div><div class="row"><span>Public publishing</span><b class="bad">Disabled</b></div>';
el('caps').innerHTML=Object.entries(s.capabilities).map(([k,v])=>'<div class="row"><span>'+k.replaceAll('_',' ')+'</span><b class="'+(v.ready?'ok':'warn')+'">'+(v.ready?'Ready':'Missing: '+v.missing.join(', '))+'</b></div>').join('');
el('channels').innerHTML=s.channels.length?s.channels.map(c=>'<div class="row"><span>'+c.name+'</span><span class="pill">'+c.status+' · '+c.privacyStatus+'</span></div>').join(''):'<div class="warn">'+(s.channelConfigError||'No channels')+'</div>';
el('stages').innerHTML=s.pipelineStages.map((x,i)=>'<span class="stage">'+(i+1)+'. '+x+'</span>').join('');
}catch(e){el('sys').innerHTML='<span class="bad">Failed to load status</span>'}}
async function decide(d){const packageId=el('pkg').value.trim();if(!packageId){el('msg').textContent='Enter a package/video ID first.';return}
const r=await fetch('/api/approval',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({packageId,decision:d})});
const b=await r.json();el('msg').textContent=r.ok?('Recorded: '+b.decision+' for '+b.packageId+' at '+b.at):('Error: '+(b.error||r.status));}
el('approve').onclick=()=>decide('approved');el('reject').onclick=()=>decide('rejected');load();
</script></body></html>`;

export function createAppServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff" });
        return response.end(MOBILE_HTML);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, service: "social-media-automation", environment: config.nodeEnv });
      }
      if (request.method === "GET" && url.pathname === "/api/platforms") {
        return sendJson(response, 200, { platforms, publishingApprovalRequired: config.requirePublishApproval });
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        return sendJson(response, 200, await getSystemStatus());
      }
      if (request.method === "POST" && url.pathname === "/api/approval") {
        let body = "";
        for await (const chunk of request) { body += chunk; if (body.length > 16384) throw new Error("Body too large"); }
        const parsed = JSON.parse(body || "{}");
        const packageId = String(parsed.packageId ?? "").trim();
        const decision = String(parsed.decision ?? "");
        if (!packageId || !["approved", "rejected"].includes(decision)) {
          return sendJson(response, 400, { error: "packageId and decision (approved|rejected) are required" });
        }
        const record = { packageId, decision, at: new Date().toISOString(), publishesAnything: false };
        const storePath = process.env.APPROVAL_STORE_PATH ?? "data/approvals.jsonl";
        await mkdir(dirname(storePath), { recursive: true });
        await appendFile(storePath, JSON.stringify(record) + "\n", { mode: 0o600 });
        return sendJson(response, 201, record);
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error.message });
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  createAppServer().listen(config.port, "0.0.0.0", () => {
    console.log(`Social Media Automation listening on port ${config.port}`);
  });
}
