import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const branch = "review/primeplug-pixabay-handoff-0a29687";

test("review-only YouTube check is confined to initial creation of the exact branch and repository", async () => {
  const workflow = await readFile(".github/workflows/primeplug-review-youtube-once.yml", "utf8");
  const trigger = workflow.match(/^on:\n(?<body>(?:[ \t].*\n|\n)+)/m)?.groups?.body;
  assert.equal(trigger?.trim(), `push:\n    branches:\n      - ${branch}`);
  for (const guard of [
    "github.event_name == 'push'",
    "github.event.created == true",
    "github.event.deleted == false",
    "github.repository == 'clipuni34-coder/Automation'",
    `github.ref == 'refs/heads/${branch}'`
  ]) assert.ok(workflow.includes(guard), `Missing check: ${guard}`);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /contents:\s*write|actions:\s*write/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /run: node scripts\/validate-youtube-oauth\.mjs/);
  assert.doesNotMatch(workflow, /upload-artifact|upload-cli|publish-awaiting|persist-channel-state|validate-hosted-voice|PIXABAY_API_KEY|GEMINI_API_KEY/);
  const referencedCredentials = [...workflow.matchAll(/\b(?:secrets|vars)\.([A-Z_]+)/g)].map(match => match[1]).sort();
  assert.deepEqual(referencedCredentials, ["REFRESH_TOKEN", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_EXPECTED_CHANNEL_ID", "YOUTUBE_REFRESH_TOKEN"]);
  assert.equal((workflow.match(/^  youtube-identity:$/gm) ?? []).length, 1);
  assert.equal((workflow.match(/^        run:/gm) ?? []).length, 1);
});
