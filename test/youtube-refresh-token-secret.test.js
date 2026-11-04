import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("discovery workflow accepts the existing REFRESH_TOKEN secret for YouTube OAuth", async () => {
  const workflow = await readFile(new URL("../.github/workflows/discovery.yml", import.meta.url), "utf8");
  const fallback = "${{ secrets.YOUTUBE_REFRESH_TOKEN || secrets.REFRESH_TOKEN }}";
  assert.equal(workflow.split(fallback).length - 1, 3, "analytics, comments and publishing auth should all support the existing secret name");
  assert.doesNotMatch(workflow, /YOUTUBE_REFRESH_TOKEN:\s*\$\{\{\s*secrets\.YOUTUBE_REFRESH_TOKEN\s*\}\}/);
});
