import { createServer } from "node:http";
import { loadConfig } from "./config/env.js";

const config = loadConfig();

const platforms = [
  { id: "youtube", name: "YouTube", status: "not_configured" },
  { id: "instagram", name: "Instagram", status: "not_configured" },
  { id: "tiktok", name: "TikTok", status: "not_configured" }
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

export function createAppServer() {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "social-media-automation",
        environment: config.nodeEnv
      });
    }

    if (request.method === "GET" && url.pathname === "/api/platforms") {
      return sendJson(response, 200, {
        platforms,
        publishingApprovalRequired: config.requirePublishApproval
      });
    }

    return sendJson(response, 404, { error: "Not found" });
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  createAppServer().listen(config.port, "0.0.0.0", () => {
    console.log(`Social Media Automation listening on port ${config.port}`);
  });
}
