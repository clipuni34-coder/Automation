import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config/env.js";

test("uses safe defaults", () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: "development",
    port: 3000,
    requirePublishApproval: true
  });
});

test("parses configured port and approval flag", () => {
  assert.deepEqual(loadConfig({
    NODE_ENV: "test",
    PORT: "4100",
    REQUIRE_PUBLISH_APPROVAL: "false"
  }), {
    nodeEnv: "test",
    port: 4100,
    requirePublishApproval: false
  });
});

test("rejects an invalid port", () => {
  assert.throws(() => loadConfig({ PORT: "70000" }), /PORT must be an integer/);
});
