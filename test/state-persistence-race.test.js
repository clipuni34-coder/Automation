import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { checkRemotePlanningState } from "../src/engine/planning-state-freshness.js";

const script = resolve("scripts/persist-channel-state.sh");
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "persist-state-"));
  const remote = join(root, "remote.git"), first = join(root, "first"), second = join(root, "second");
  git(["init", "--bare", remote], root);
  git(["clone", remote, first], root);
  for (const r of [first]) { git(["config", "user.name", "Test"], r); git(["config", "user.email", "test@example.invalid"], r); }
  git(["switch", "-c", "automation-state"], first);
  await mkdir(join(first, "Primeplug"), { recursive: true });
  await writeFile(join(first, "Primeplug/planning-inbox.json"), '{"decision":"pending"}\n');
  await writeFile(join(first, "Primeplug/control.json"), '{"paused":false}\n');
  git(["add", "."], first); git(["commit", "-m", "initial state"], first); git(["push", "-u", "origin", "automation-state"], first);
  git(["clone", "--branch", "automation-state", remote, second], root);
  git(["config", "user.name", "Test"], second); git(["config", "user.email", "test@example.invalid"], second);
  return { root, remote, first, second, cleanup: () => rm(root, { recursive: true, force: true }) };
}
function persist(dir) {
  return spawnSync("bash", [script, dir], { encoding: "utf8", timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
function advanceRemote(dir) { git(["add", "."], dir); git(["commit", "-m", "concurrent state update"], dir); git(["push", "origin", "automation-state"], dir); }
function remoteFile(remote, name) { return git(["--git-dir", remote, "show", `automation-state:${name}`]); }

test("a non-overlapping state advance is rebased and both updates persist", async () => {
  const t = await fixture();
  try {
    await writeFile(join(t.second, "Primeplug/planning-inbox.json"), '{"decision":"reviewed"}\n');
    await writeFile(join(t.first, "Primeplug/control.json"), '{"paused":true}\n');
    advanceRemote(t.first);
    const result = persist(t.second);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(remoteFile(t.remote, "Primeplug/planning-inbox.json")).decision, "reviewed");
    assert.equal(JSON.parse(remoteFile(t.remote, "Primeplug/control.json")).paused, true);
  } finally { await t.cleanup(); }
});

test("concurrent changes to review, queue or upload state fail rather than overwrite", async () => {
  const t = await fixture();
  try {
    await writeFile(join(t.second, "Primeplug/planning-inbox.json"), '{"decision":"reviewed"}\n');
    await writeFile(join(t.first, "Primeplug/planning-inbox.json"), '{"decision":"rejected"}\n');
    advanceRemote(t.first);
    const result = persist(t.second);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Concurrent state change.*refusing automatic overwrite/);
    assert.equal(JSON.parse(remoteFile(t.remote, "Primeplug/planning-inbox.json")).decision, "rejected");
    assert.equal(JSON.parse(await readFile(join(t.second, "Primeplug/planning-inbox.json"), "utf8")).decision, "reviewed", "local evidence remains available for reconciliation");
  } finally { await t.cleanup(); }
});

test("concurrent Pixabay search caches are never silently overwritten", async () => {
  const t = await fixture();
  try {
    await writeFile(join(t.second, "Primeplug/pixabay-search-cache.json"), '{"writer":"second"}\n');
    await writeFile(join(t.first, "Primeplug/pixabay-search-cache.json"), '{"writer":"first"}\n');
    advanceRemote(t.first);
    const result = persist(t.second);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Concurrent state change.*pixabay-search-cache\.json/);
    assert.equal(JSON.parse(remoteFile(t.remote, "Primeplug/pixabay-search-cache.json")).writer, "first");
    assert.equal(JSON.parse(await readFile(join(t.second, "Primeplug/pixabay-search-cache.json"), "utf8")).writer, "second");
  } finally { await t.cleanup(); }
});

test("attempt-time remote check detects a review change and fails closed on fetch errors", async () => {
  const t = await fixture();
  try {
    assert.equal(checkRemotePlanningState({ stateRoot: t.second }).fresh, true);
    await writeFile(join(t.first, "Primeplug/planning-inbox.json"), '{"decision":"rejected"}\n');
    advanceRemote(t.first);
    const changed = checkRemotePlanningState({ stateRoot: t.second });
    assert.equal(changed.fresh, false);
    assert.match(changed.reason, /changed during this run/);
    git(["remote", "set-url", "origin", join(t.root, "not-a-remote.git")], t.second);
    const unavailable = checkRemotePlanningState({ stateRoot: t.second });
    assert.equal(unavailable.fresh, false);
    assert.match(unavailable.reason, /could not be verified/);
    assert.equal(checkRemotePlanningState({ stateRoot: t.second, channelId: "Other" }).fresh, false);
  } finally { await t.cleanup(); }
});
