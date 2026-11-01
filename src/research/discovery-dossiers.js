import { createHash } from "node:crypto";
import { assessCandidateSuitability } from "../strategy/candidate-suitability.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function buildDiscoveryDossiers(discovery, { maxDossiers = 3, minimumScore = 35, generatedAt = new Date().toISOString() } = {}) {
  const candidates = (discovery?.candidates ?? [])
    .filter(item => item?.id && item?.title && item?.sourceUrl && Number(item.score ?? 0) >= minimumScore && assessCandidateSuitability(item).eligible)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const seen = new Set();
  const selected = [];
  for (const candidate of candidates) {
    const key = candidate.topicKey ?? candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(candidate);
    if (selected.length >= Math.max(1, Math.min(10, maxDossiers))) break;
  }
  return selected.map(candidate => ({
    topic: candidate.title,
    topicKey: candidate.topicKey ?? null,
    candidateId: candidate.id,
    generatedAt,
    researchStatus: "discovery_metadata_only",
    summary: "This is an initial opportunity lead from public discovery metadata. It is not independently fact-checked and is not permission to reuse the referenced media.",
    evidence: [{
      title: candidate.title,
      url: candidate.sourceUrl,
      sourceExcerpt: String(candidate.description ?? "").slice(0, 2500),
      sourceType: candidate.platform ?? "unknown",
      publishedAt: candidate.publishedAt ?? null,
      observedAt: candidate.observedAt ?? candidate.lastSeenAt ?? null,
      observedMetrics: candidate.metrics ?? {},
      regionsObserved: candidate.seenInRegions ?? [],
      collectionMethod: candidate.collectionMethod ?? "public discovery metadata",
      rightsStatus: candidate.rightsStatus ?? "reference_only",
      verification: "unverified_search_result"
    }],
    discoveryEvidence: {
      score: candidate.score ?? null,
      scoreComponents: candidate.scoreComponents ?? {},
      confidence: candidate.confidence ?? "low",
      momentum: candidate.momentum ?? "unverified",
      decisionReasons: candidate.decisionReasons ?? []
    },
    limitations: [
      "No independent web research was available for this dossier.",
      "Do not state unsupported facts as established truth.",
      "All factual claims must remain qualified or be independently verified before publication.",
      "The source video is a research reference only unless separate reuse rights are documented."
    ]
  }));
}

export async function writeDiscoveryDossiers(dossiers, outputDirectory = ".") {
  await mkdir(resolve(outputDirectory), { recursive: true });
  const files = [];
  for (const dossier of dossiers) {
    const slug = String(dossier.topic).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "topic";
    const suffix = createHash("sha256").update(String(dossier.candidateId)).digest("hex").slice(0, 8);
    const path = resolve(outputDirectory, `research-${slug}-${suffix}.json`);
    await writeFile(path, JSON.stringify(dossier, null, 2) + "\n", { mode: 0o600 });
    files.push(path);
  }
  return files;
}
