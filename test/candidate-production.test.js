import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("candidate production workflow never uploads and uses rights-cleared sources", async () => {
  const workflow = await readFile(new URL("../.github/workflows/candidate-production.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /upload-private-smoke|youtube-upload|SMOKE_UPLOAD/);
  assert.match(workflow, /public_domain/);
  assert.match(workflow, /compare-candidates/);
  assert.match(workflow, /upload-artifact/);
});

test("candidate manifest records rights evidence and resolution for every candidate", async () => {
  const manifest = JSON.parse(await readFile(new URL("../config/candidate-manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.length >= 5);
  for (const c of manifest) {
    assert.match(c.rightsEvidenceUrl, /^https:\/\//, c.id);
    assert.match(c.sourceUrl, /^https:\/\//, c.id);
    assert.match(c.sourceResolution, /^\d+x\d+$/, c.id);
    assert.ok(c.creator, c.id);
  }
});

test("compare-candidates script ranks only completed candidates", async () => {
  const script = await readFile(new URL("../scripts/compare-candidates.mjs", import.meta.url), "utf8");
  assert.match(script, /rankScore/);
  assert.match(script, /editorial_review_required|completed/);
});
