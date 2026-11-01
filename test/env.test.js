import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env.js";

test("uses safe defaults", () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: "development",
    port: 3000,
    tavilyApiKey: "",
    geminiApiKey: "",
    openaiApiKey: "",
    requirePublishApproval: true
  });
});

test("parses configured port, research key and approval flag", () => {
  assert.deepEqual(loadConfig({
    NODE_ENV: "test",
    PORT: "4100",
    TAVILY_API_KEY: "research-key",
    REQUIRE_PUBLISH_APPROVAL: "false"
  }), {
    nodeEnv: "test",
    port: 4100,
    tavilyApiKey: "research-key",
    geminiApiKey: "",
    openaiApiKey: "",
    requirePublishApproval: false
  });
});

test("rejects an invalid port", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT must be an integer/);
});
