// Persistent per-channel state. Plain JSON files on disk so the same code
// works locally, in GitHub Actions (state directory committed to the
// dedicated `automation-state` branch), or on any host. Writes are atomic
// (tmp file + rename) and channels can never see each other's state.
import { mkdir, readFile, rename, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

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
  async hasUsedSource(sourceUrl) {
    const db = await this.getSources();
    return Boolean(db.sources[sourceFingerprint(sourceUrl)]);
  }
  async recordSource(candidate, outcome) {
    const db = await this.getSources();
    const fp = sourceFingerprint(candidate.sourceUrl);
    db.sources[fp] = {
      fingerprint: fp, sourceUrl: candidate.sourceUrl, title: candidate.title ?? null,
      creator: candidate.creator ?? null, firstSeenAt: db.sources[fp]?.firstSeenAt ?? new Date().toISOString(),
      lastOutcome: outcome, updatedAt: new Date().toISOString()
    };
    await writeJsonAtomic(this.path("sources.json"), db);
    return db.sources[fp];
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
