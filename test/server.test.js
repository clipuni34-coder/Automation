import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";

test("health and platform endpoints return expected status", async (t) => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).ok, true);

  const platformsResponse = await fetch(`${baseUrl}/api/platforms`);
  assert.equal(platformsResponse.status, 200);
  const body = await platformsResponse.json();
  assert.deepEqual(body.platforms.map((platform) => platform.id), [
    "youtube", "instagram", "tiktok"
  ]);
  assert.ok(body.platforms.every((platform) => platform.status === "not_configured"));
  assert.equal(body.publishingApprovalRequired, true);

  const missingResponse = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(missingResponse.status, 404);
});
