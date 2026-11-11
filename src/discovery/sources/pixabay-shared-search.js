// Explicit, operator-initiated Pixabay searches coordinated through a
// dedicated remote Git branch. This is NOT wired into daily discovery.
//
// Before any provider request, a pending cache reservation is committed and
// compare-and-swap pushed. A crash, an uncertain push, or a response whose
// final cache commit cannot be confirmed remains a hold. The branch must be
// initialized and protected out of band only after all previous usage is
// reconciled. It cannot coordinate calls made outside this shared mechanism.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openChannelState } from "../../engine/state.js";
import { PIXABAY_MAX_RECENT_QUERIES, searchPixabayForReview, validatePixabayLead } from "./pixabay-planning.js";

export const PIXABAY_SHARED_BRANCH = "refs/heads/primeplug-pixabay-cache";
export const PIXABAY_SHARED_CACHE_PATH = "Primeplug/pixabay-search-cache.json";
export const PIXABAY_SHARED_MARKER_PATH = ".primeplug-pixabay-cache.json";
export const PIXABAY_SHARED_MARKER = Object.freeze({ version: 1, kind: "primeplug_pixabay_shared_cache", scope: "all_searches_using_this_cache" });
const MAX_GIT_OUTPUT = 2 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{40,64}$/;

function cleanGitEnv(extra = {}) {
  // The media-provider key must not be inherited by git, credential helpers,
  // hooks, or remote transport programs. Git authentication remains separate.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" };
  for (const key of Object.keys(env)) {
    if (["PIXABAY_API_KEY", "GEMINI_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN", "REFRESH_TOKEN", "YOUTUBE_DATA_API_KEY",
      "GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"].includes(key)
      || /^GIT_CONFIG_(?:KEY|VALUE)_/.test(key) || /^GIT_TRACE/.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function git(repository, scratch, args, { input, extraEnv = {}, operation = "git operation" } = {}) {
  const result = spawnSync("git", ["-C", repository, "-c", `core.hooksPath=${join(scratch, "empty-hooks")}`, "-c", "commit.gpgsign=false", ...args], {
    input, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT, timeout: 45000,
    env: cleanGitEnv(extraEnv)
  });
  if (result.error || result.status !== 0) throw new Error(`Shared Pixabay cache ${operation} could not be confirmed.`);
  return result.stdout;
}
function gitHash(value) {
  const id = String(value).trim();
  if (!hashPattern.test(id)) throw new Error("Shared Pixabay cache returned an invalid Git object id.");
  return id;
}
function containsKey(value, apiKey) {
  if (!apiKey) return false;
  const key = String(apiKey);
  const forms = [...new Set([key, encodeURIComponent(key), new URLSearchParams({ key }).toString().slice(4)])].filter(Boolean);
  return forms.some((form) => value.includes(form));
}
function validateCacheForTransition(text) {
  let cache;
  try { cache = JSON.parse(text); } catch { throw new Error("Shared Pixabay cache is invalid JSON; no provider request was sent."); }
  if (cache?.version !== 1 || !Array.isArray(cache.entries) || cache.entries.length > PIXABAY_MAX_RECENT_QUERIES || cache.entries.some((entry) =>
    !/^[a-f0-9]{64}$/.test(entry?.key ?? "") || !Number.isFinite(Date.parse(entry?.fetchedAt)) || !["ok", "failed", "pending"].includes(entry?.status)
    || !Array.isArray(entry?.leads) || entry.leads.length > 12 || (entry.status !== "ok" && entry.leads.length) || entry.leads.some((lead) => !validatePixabayLead(lead)))) {
    throw new Error("Shared Pixabay cache has an invalid shape; no provider request was sent.");
  }
  if (new Set(cache.entries.map((entry) => entry.key)).size !== cache.entries.length) throw new Error("Shared Pixabay cache contains duplicate queries; no provider request was sent.");
  return cache;
}
function validateTree(repository, scratch, head) {
  const entries = git(repository, scratch, ["ls-tree", "-rz", "--full-tree", head], { operation: "tree inspection" }).split("\0").filter(Boolean);
  const paths = [];
  for (const entry of entries) {
    const match = /^100644 blob [a-f0-9]{40,64}\t(.+)$/.exec(entry);
    if (!match) throw new Error("The dedicated Pixabay cache branch contains an unsafe tree entry.");
    paths.push(match[1]);
  }
  if (paths.length !== 2 || !paths.includes(PIXABAY_SHARED_CACHE_PATH) || !paths.includes(PIXABAY_SHARED_MARKER_PATH)) {
    throw new Error("The dedicated Pixabay cache branch must contain only its marker and cache; no provider request was sent.");
  }
  let marker;
  try { marker = JSON.parse(git(repository, scratch, ["cat-file", "blob", `${head}:${PIXABAY_SHARED_MARKER_PATH}`], { operation: "marker read" })); }
  catch { throw new Error("The dedicated Pixabay cache marker is missing or invalid; no provider request was sent."); }
  if (!marker || typeof marker !== "object" || Array.isArray(marker) || Object.keys(marker).length !== Object.keys(PIXABAY_SHARED_MARKER).length
      || Object.entries(PIXABAY_SHARED_MARKER).some(([key, value]) => marker[key] !== value)) {
    throw new Error("The dedicated Pixabay cache marker is unexpected; no provider request was sent.");
  }
  return git(repository, scratch, ["cat-file", "blob", `${head}:${PIXABAY_SHARED_CACHE_PATH}`], { operation: "cache read" });
}

// The candidate commit is ALWAYS constructed with exactly `expectedHead` as
// its parent and the unchanged tree plus one cache blob. --force-with-lease is
// used solely for an exact old-head compare-and-swap, including branch
// deletion; because the new commit is a direct child it cannot rewrite history.
function commitAndCompareSwap(repository, scratch, expectedHead, cacheText, message, apiKey) {
  if (!hashPattern.test(expectedHead) || containsKey(cacheText, apiKey)) throw new Error("Shared cache cannot be saved safely.");
  validateCacheForTransition(cacheText);
  const index = join(scratch, `index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: "Primeplug cache", GIT_AUTHOR_EMAIL: "primeplug-cache@localhost", GIT_COMMITTER_NAME: "Primeplug cache", GIT_COMMITTER_EMAIL: "primeplug-cache@localhost" };
  git(repository, scratch, ["read-tree", expectedHead], { extraEnv: env, operation: "index preparation" });
  const blob = gitHash(git(repository, scratch, ["hash-object", "-w", "--stdin"], { input: cacheText, extraEnv: env, operation: "cache object write" }));
  git(repository, scratch, ["update-index", "--add", "--cacheinfo", `100644,${blob},${PIXABAY_SHARED_CACHE_PATH}`], { extraEnv: env, operation: "index update" });
  const tree = gitHash(git(repository, scratch, ["write-tree"], { extraEnv: env, operation: "tree write" }));
  const commit = gitHash(git(repository, scratch, ["commit-tree", tree, "-p", expectedHead, "-m", message], { extraEnv: env, operation: "commit creation" }));
  const parents = git(repository, scratch, ["rev-list", "--parents", "-n", "1", commit], { operation: "commit verification" }).trim().split(/\s+/);
  if (parents.length !== 2 || parents[0] !== commit || parents[1] !== expectedHead) throw new Error("Shared cache commit is not a direct descendant; push refused.");
  const changed = git(repository, scratch, ["diff-tree", "--no-commit-id", "--no-ext-diff", "--name-only", "-r", "-z", expectedHead, commit], { operation: "commit change verification" }).split("\0").filter(Boolean);
  if (changed.length !== 1 || changed[0] !== PIXABAY_SHARED_CACHE_PATH) throw new Error("Shared cache commit changes unexpected files; push refused.");
  git(repository, scratch, ["push", "--quiet", "--no-follow-tags", "--recurse-submodules=no", `--force-with-lease=${PIXABAY_SHARED_BRANCH}:${expectedHead}`, "origin", `${commit}:${PIXABAY_SHARED_BRANCH}`], { operation: "compare-and-swap push" });
  return commit;
}

function validCompletion(reservedText, completedText) {
  const before = validateCacheForTransition(reservedText), after = validateCacheForTransition(completedText);
  if (before.entries.length !== after.entries.length || before.entries.filter((x) => x.status === "pending").length !== 1) return false;
  const reserved = before.entries.find((x) => x.status === "pending");
  const finished = after.entries.find((x) => x.key === reserved.key);
  if (!finished || !["ok", "failed"].includes(finished.status) || Date.parse(finished.fetchedAt) < Date.parse(reserved.fetchedAt)) return false;
  const oldOthers = before.entries.filter((x) => x.key !== reserved.key);
  const newOthers = after.entries.filter((x) => x.key !== reserved.key);
  return JSON.stringify(oldOthers) === JSON.stringify(newOthers);
}

// This function can update origin/primeplug-pixabay-cache; it must only be
// called after the user has explicitly authorized that remote operation and
// the operator has checked the machine clock. It never deploys code, changes
// the schedule, downloads a video, alters inbox state, or approves an upload.
// beforeReservationCommit is an injectable synchronization hook for tests.
export async function searchPixabayShared({
  repository = process.cwd(), query, apiKey = process.env.PIXABAY_API_KEY ?? "",
  fetchImpl = fetch, now = () => new Date(), authorized = false, clockVerified = false,
  beforeReservationCommit = async () => {}
} = {}) {
  if (!authorized || !clockVerified) throw new Error("Shared search requires explicit remote-operation authorization and a verified runner clock.");
  const repo = resolve(repository), scratch = await mkdtemp(join(tmpdir(), "primeplug-pixabay-shared-"));
  const temporaryRef = `refs/primeplug/pixabay-cache-${randomUUID()}`;
  let reservationAttempted = false, reservationHead = null, reservedText = null, providerStarted = false;
  try {
    await mkdir(join(scratch, "empty-hooks"));
    // Read and write exactly the same single remote, never a different push
    // URL or a list of mirrors. Remote URLs can contain credentials and must
    // never appear in diagnostics.
    const fetchRemotes = git(repo, scratch, ["remote", "get-url", "--all", "origin"], { operation: "remote inspection" }).trim().split(/\r?\n/);
    const pushRemotes = git(repo, scratch, ["remote", "get-url", "--push", "--all", "origin"], { operation: "remote inspection" }).trim().split(/\r?\n/);
    if (fetchRemotes.length !== 1 || pushRemotes.length !== 1 || !fetchRemotes[0] || fetchRemotes[0] !== pushRemotes[0]) {
      throw new Error("The shared cache requires exactly one matching origin fetch and push URL; no provider request was sent.");
    }
    // Never create a missing remote branch automatically: it may be a lost
    // cache, not a clean slate. A unique ref avoids shared FETCH_HEAD.
    git(repo, scratch, ["fetch", "--quiet", "--no-tags", "--no-prune", "--no-write-fetch-head", "--no-recurse-submodules", "origin", `${PIXABAY_SHARED_BRANCH}:${temporaryRef}`], { operation: "branch fetch" });
    const head = gitHash(git(repo, scratch, ["rev-parse", "--verify", `${temporaryRef}^{commit}`], { operation: "head read" }));
    const original = validateTree(repo, scratch, head);
    const remoteCache = validateCacheForTransition(original);
    if (containsKey(original, apiKey)) throw new Error("The shared cache appears to contain the configured key; stop and investigate before use.");
    if (remoteCache.entries.some((entry) => entry.status === "pending")) {
      throw new Error("A shared Pixabay request is pending or uncertain; investigate it before any new search, even a different query.");
    }
    const state = await openChannelState(scratch, "Primeplug");
    await writeFile(state.path("pixabay-search-cache.json"), original, { mode: 0o600, flag: "wx" });
    let result, searchError;
    try {
      result = await searchPixabayForReview(state, query, { apiKey, now, fetchImpl: async (url, options) => {
        reservedText = await readFile(state.path("pixabay-search-cache.json"), "utf8");
        const reserved = validateCacheForTransition(reservedText);
        if (reserved.entries.filter((entry) => entry.status === "pending").length !== 1) throw new Error("Reservation was not created safely.");
        await beforeReservationCommit();
        reservationAttempted = true;
        reservationHead = commitAndCompareSwap(repo, scratch, head, reservedText, "Reserve Pixabay search [skip ci]", apiKey);
        providerStarted = true;
        return fetchImpl(url, options);
      } });
    } catch (error) { searchError = error; }

    if (reservationAttempted && !reservationHead) {
      // Even if a network timeout made the push outcome uncertain, do not
      // contact the provider. The remote may now hold a pending reservation.
      throw new Error("The shared reservation could not be confirmed; no Pixabay request was sent. Inspect the remote cache before retrying.");
    }
    let finalHead = head;
    if (reservationHead) {
      let completedText;
      try { completedText = await readFile(state.path("pixabay-search-cache.json"), "utf8"); }
      catch { throw new Error("The provider request may have completed but its shared reservation remains unresolved; investigate before retrying."); }
      if (completedText === reservedText) {
        throw new Error("The provider request may have completed but the shared reservation is still pending; investigate before retrying.");
      }
      if (!validCompletion(reservedText, completedText) || containsKey(completedText, apiKey)) {
        throw new Error("The provider result could not be safely recorded; the shared reservation remains unresolved. Investigate before retrying.");
      }
      try { finalHead = commitAndCompareSwap(repo, scratch, reservationHead, completedText, "Record Pixabay search result [skip ci]", apiKey); }
      catch { throw new Error("The provider result's shared cache update could not be confirmed; investigate the remote reservation before retrying."); }
    }
    if (searchError) throw searchError;
    if (!result) throw new Error("Shared Pixabay search did not return a result.");
    return { ...result, cacheMode: "shared_git_compare_and_swap", providerRequestSent: providerStarted, cacheHead: finalHead };
  } finally {
    try { git(repo, scratch, ["update-ref", "-d", temporaryRef], { operation: "temporary ref cleanup" }); } catch { /* no provider request is made here */ }
    await rm(scratch, { recursive: true, force: true });
  }
}
