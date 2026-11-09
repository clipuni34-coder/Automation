// Persistent per-channel state. Plain JSON files on disk so the same code
// works locally, in GitHub Actions (state directory committed to the
// dedicated `automation-state` branch), or on any host. Writes are atomic
// (tmp file + rename) and channels can never see each other's state.
import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sameSourceUrl } from "./source-identity.js";

export function sourceFingerprint(sourceUrl, extra = "") {
  return createHash("sha256").update(`${sourceUrl}\n${extra}`).digest("hex").slice(0, 24);
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}
async function writeJsonAtomic(path, value) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

export class ChannelState {
  constructor(rootDir, channelId) {
    if (!/^[A-Za-z0-9_-]+$/.test(channelId)) throw new Error(`Invalid channel id for state: ${channelId}`);
    this.dir = join(rootDir, channelId);
    this.channelId = channelId;
  }
  async init() { await mkdir(this.dir, { recursive: true }); return this; }
  path(name) { return join(this.dir, name); }

  async getControl() { return { paused: false, ...(await readJson(this.path("control.json"), {})) }; }
  async setPaused(paused, by = "dashboard") {
    const control = { ...(await this.getControl()), paused: Boolean(paused), updatedAt: new Date().toISOString(), updatedBy: by };
    await writeJsonAtomic(this.path("control.json"), control);
    return control;
  }

  async getSources() { return readJson(this.path("sources.json"), { version: 1, sources: {} }); }
  async hasUsedSource(sourceUrl, opts = {}) {
    const db = await this.getSources();
    const entries = Object.values(db.sources).filter((entry) => sameSourceUrl(entry.sourceUrl, sourceUrl));
    // Older discovery reports used "eligible" even for unplanned footage or
    // candidates over the daily limit. Distinguish those from actual work by
    // consulting the queue, including URL variants with Commons tracking tags.
    const queue = await this.getQueue();
    if (queue.jobs.some((j) => ["queued", "running", "completed", "failed"].includes(j.status) && sameSourceUrl(j.candidate?.sourceUrl, sourceUrl))) return true;
    return entries.some((entry) => {
      if (opts.rescreenRejected && entry.lastOutcome === "rejected") return false;
      if (entry.lastOutcome === "deferred_capacity") return false;
      if (opts.reconsiderPlanned && entry.lastOutcome === "awaiting_plan") return false;
      if (opts.reconsiderUnqueued && entry.lastOutcome === "eligible") return false;
      return true;
    });
  }
  async recordSource(candidate, outcome) {
    const db = await this.getSources();
    const fp = sourceFingerprint(candidate.sourceUrl);
    db.sources[fp] = {
      fingerprint: fp, sourceUrl: candidate.sourceUrl, title: candidate.title ?? null,
      creator: candidate.creator ?? null,
      rightsVerification: candidate.rightsVerification ? { status: candidate.rightsVerification.status, observedLicence: candidate.rightsVerification.observedLicence ?? null, licenceFamily: candidate.rightsVerification.licenceFamily ?? null, licenceVersion: candidate.rightsVerification.licenceVersion ?? null, shareAlike: candidate.rightsVerification.shareAlike ?? null, licenceUrl: candidate.rightsVerification.licenceUrl ?? null, attributionRequired: candidate.rightsVerification.attributionRequired ?? null, commercialUse: candidate.rightsVerification.commercialUse ?? null, derivativesAllowed: candidate.rightsVerification.derivativesAllowed ?? null, checkedAt: candidate.rightsVerification.checkedAt ?? null } : null,
      firstSeenAt: db.sources[fp]?.firstSeenAt ?? new Date().toISOString(),
      lastOutcome: outcome, updatedAt: new Date().toISOString()
    };
    await writeJsonAtomic(this.path("sources.json"), db);
    return db.sources[fp];
  }

  // Backfill/refresh the persisted rights-verification summary for an
  // already-recorded source (e.g. a deduped seed re-verified this cycle)
  // without touching its recorded outcome or first-seen timestamp.
  async refreshSourceRights(candidate) {
    if (!candidate?.rightsVerification || !candidate?.sourceUrl) return null;
    const db = await this.getSources();
    const fp = sourceFingerprint(candidate.sourceUrl);
    const existing = db.sources[fp];
    if (!existing) return null;
    existing.rightsVerification = { status: candidate.rightsVerification.status, observedLicence: candidate.rightsVerification.observedLicence ?? null, licenceFamily: candidate.rightsVerification.licenceFamily ?? null, licenceVersion: candidate.rightsVerification.licenceVersion ?? null, shareAlike: candidate.rightsVerification.shareAlike ?? null, licenceUrl: candidate.rightsVerification.licenceUrl ?? null, attributionRequired: candidate.rightsVerification.attributionRequired ?? null, commercialUse: candidate.rightsVerification.commercialUse ?? null, derivativesAllowed: candidate.rightsVerification.derivativesAllowed ?? null, checkedAt: candidate.rightsVerification.checkedAt ?? null };
    existing.updatedAt = new Date().toISOString();
    await writeJsonAtomic(this.path("sources.json"), db);
    return existing;
  }

  async getQueue() { return readJson(this.path("queue.json"), { version: 1, jobs: [] }); }
  async saveQueue(queue) { await writeJsonAtomic(this.path("queue.json"), queue); return queue; }
  async enqueue(job) {
    const queue = await this.getQueue();
    if (queue.jobs.some((j) => j.fingerprint === job.fingerprint && ["queued", "running", "completed"].includes(j.status))) {
      return { enqueued: false, reason: "duplicate_fingerprint", job: queue.jobs.find((j) => j.fingerprint === job.fingerprint) };
    }
    const record = { attempts: 0, status: "queued", createdAt: new Date().toISOString(), ...job };
    queue.jobs.push(record);
    await this.saveQueue(queue);
    return { enqueued: true, job: record };
  }

  async getPublished() { return readJson(this.path("published.json"), { version: 1, videos: [] }); }
  async hasPublishedFingerprint(fingerprint) {
    return (await this.getPublished()).videos.some((v) => v.fingerprint === fingerprint);
  }
  async recordPublished(record) {
    const db = await this.getPublished();
    db.videos.push({ recordedAt: new Date().toISOString(), ...record });
    await writeJsonAtomic(this.path("published.json"), db);
    return db;
  }
  async updatePublishedVerification(fingerprint, patch) {
    const db = await this.getPublished();
    const matches = db.videos.filter((video) => video.fingerprint === fingerprint);
    if (matches.length !== 1) throw new Error("Expected exactly one published record to update");
    const allowed = ["processingStatus", "uploadVerification", "selfDeclaredMadeForKids", "madeForKids"];
    for (const key of allowed) if (Object.hasOwn(patch, key)) matches[0][key] = patch[key];
    await writeJsonAtomic(this.path("published.json"), db);
    return matches[0];
  }

  // A durable reservation prevents an uncertain upload from being retried.
  // Unlike ordinary optional state, an invalid ledger is an error: treating a
  // corrupt ledger as empty could upload the same private video twice.
  async getUploadAttempts() {
    let text;
    try { text = await readFile(this.path("upload-attempts.json"), "utf8"); }
    catch (error) { if (error.code === "ENOENT") return { version: 1, attempts: [] }; throw error; }
    let db;
    try { db = JSON.parse(text); } catch { throw new Error("Upload-attempt ledger is invalid JSON"); }
    if (db?.version !== 1 || !Array.isArray(db.attempts) || db.attempts.some((a) => !a || typeof a.attemptId !== "string" || !/^[a-f0-9]{64}$/.test(a.fingerprint ?? "") || typeof a.status !== "string")) {
      throw new Error("Upload-attempt ledger has an invalid shape");
    }
    return db;
  }
  async reserveUploadAttempt({ attemptId, candidateId, fingerprint, approvedAudience }) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(attemptId ?? "")) || !/^[A-Za-z0-9_-]{1,120}$/.test(String(candidateId ?? "")) || !/^[a-f0-9]{64}$/.test(String(fingerprint ?? "")) || !["made_for_kids", "not_made_for_kids"].includes(approvedAudience)) {
      throw new Error("A valid attempt, candidate, fingerprint, and reviewed audience are required");
    }
    const db = await this.getUploadAttempts();
    if (db.attempts.some((a) => a.attemptId === attemptId || (a.fingerprint === fingerprint && a.status !== "released_no_upload"))) {
      throw new Error("An upload attempt already exists; inspect YouTube and reconcile before any retry");
    }
    if (await this.hasPublishedFingerprint(fingerprint)) throw new Error("This fingerprint is already recorded as uploaded");
    const record = { attemptId, candidateId, fingerprint, approvedAudience, status: "reserved", reservedAt: new Date().toISOString() };
    db.attempts.push(record);
    await writeJsonAtomic(this.path("upload-attempts.json"), db);
    return record;
  }
  async transitionUploadAttempt(attemptId, status, extra = {}) {
    const db = await this.getUploadAttempts();
    const matches = db.attempts.filter((a) => a.attemptId === attemptId);
    if (matches.length !== 1) throw new Error("Expected exactly one upload-attempt reservation");
    const attempt = matches[0];
    const allowed = { reserved: ["attempting"], attempting: ["uploaded", "unknown"], uploaded: ["verified"] };
    if (!allowed[attempt.status]?.includes(status)) throw new Error(`Invalid upload-attempt transition ${attempt.status} -> ${status}`);
    attempt.status = status;
    attempt.updatedAt = new Date().toISOString();
    for (const key of ["videoId", "watchUrl"]) if (typeof extra[key] === "string") attempt[key] = extra[key];
    await writeJsonAtomic(this.path("upload-attempts.json"), db);
    return attempt;
  }

  async saveAnalytics(snapshot) { await writeJsonAtomic(this.path("analytics.json"), snapshot); return snapshot; }
  async getAnalytics() { return readJson(this.path("analytics.json"), null); }
  async saveFeedback(feedback) { await writeJsonAtomic(this.path("feedback.json"), feedback); return feedback; }
  async appendRun(run) {
    await appendFile(this.path("runs.jsonl"), JSON.stringify(run) + "\n", { mode: 0o600 });
    return run;
  }
  async summary() {
    const [control, sources, queue, published, analytics] = await Promise.all([
      this.getControl(), this.getSources(), this.getQueue(), this.getPublished(), this.getAnalytics()
    ]);
    return {
      channelId: this.channelId, paused: control.paused,
      sourcesSeen: Object.keys(sources.sources).length,
      jobs: {
        total: queue.jobs.length,
        queued: queue.jobs.filter((j) => j.status === "queued").length,
        completed: queue.jobs.filter((j) => j.status === "completed").length,
        failed: queue.jobs.filter((j) => j.status === "failed").length
      },
      publishedCount: published.videos.length,
      awaitingApproval: queue.jobs.filter((j) => j.status === "completed" && j.result?.produced === true && j.result?.sha256 && !published.videos.some((v) => v.fingerprint === j.result.sha256)).length,
      lastError: [...queue.jobs].reverse().find((j) => j.lastError)?.lastError ?? null,
      published: published.videos.slice(-5),
      analytics: analytics ? {
        fetchedAt: analytics.fetchedAt ?? null,
        totals: analytics.totals ?? null
      } : null
    };
  }
}

export async function openChannelState(rootDir, channelId) {
  return new ChannelState(rootDir, channelId).init();
}
