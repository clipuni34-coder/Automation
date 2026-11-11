// Explicit editorial review commands. None of these commands publishes,
// changes channel settings, or automatically certifies AI-generated text.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openChannelState } from "../src/engine/state.js";
import { approveReviewedPlan, hashSourceFile, ingestPixabayLeads, makePlanTemplate, materializeReviewedBootstrap, planningSummary, readPlanningInbox, rejectPlanningSource, reviewedPlanningSeeds } from "../src/engine/planning-inbox.js";
import { searchPixabayForReview } from "../src/discovery/sources/pixabay-planning.js";

const root = resolve(process.env.STATE_DIR ?? "data/state");
const channelId = process.env.PLANNING_CHANNEL_ID ?? "Primeplug";
const [command = "help", key, draftPath, reviewPath, sourcePath] = process.argv.slice(2);
const state = await openChannelState(root, channelId);
const bootstrapPath = channelId === "Primeplug" ? resolve("config/primeplug-reviewed-backlog.json") : null;
const usage = `Primeplug planning review (no upload)\n\nSTATE_DIR=state node scripts/planning-inbox.mjs list\nSTATE_DIR=state node scripts/planning-inbox.mjs show <source-key>\nSTATE_DIR=state node scripts/planning-inbox.mjs template <source-key> <draft.json>\nSTATE_DIR=state node scripts/planning-inbox.mjs review <source-key> <draft.json> <review.json> <reviewed-source-file>\nSTATE_DIR=state node scripts/planning-inbox.mjs reject <source-key> <reviewer> <reason>\nSTATE_DIR=state node scripts/planning-inbox.mjs search-pixabay "funny animals"\n\nPixabay search is a bounded operator-initiated lead search, cached 24 hours. Pixabay leads remain blocked from production: provider-specific rights verification is not yet implemented. Before reviewing any source: inspect the exact file and complete source window, verify each claim and rights terms, and fill the separate review.json. Review only promotes a production candidate; it is not upload approval. See docs/PRIMEPLUG_PLANNING.md.`;
try {
  if (channelId !== "Primeplug") throw new Error("This planning workflow is restricted to the Primeplug channel.");
  // A Pixabay lead search must not silently materialize the two separate
  // assistant-reviewed cat plans into the operator's state.
  if (command !== "help" && command !== "search-pixabay") {
    const imported = await materializeReviewedBootstrap(state, { bootstrapPath });
    if (imported.invalid.length) console.error(`Held ${imported.invalid.length} invalid bootstrap record(s); use check for details.`);
  }
  if (command === "help") console.log(usage);
  else if (command === "search-pixabay") {
    if (!key || draftPath || reviewPath || sourcePath) throw new Error('Provide one quoted, operator-chosen search, for example: search-pixabay "funny animals".');
    const search = await searchPixabayForReview(state, key);
    const intake = await ingestPixabayLeads(state, search.leads);
    console.log(JSON.stringify({ status: "unverified_leads_only", provider: "pixabay", cached: search.cached, fetchedAt: search.fetchedAt, found: search.leads.length, ...intake,
      reminder: "No source, individual licence or third-party rights were approved. Pixabay leads cannot enter production until provider-specific verification is implemented." }, null, 2));
  } else if (command === "list") {
    const db = await readPlanningInbox(state);
    const summary = await planningSummary(state, { bootstrapPath });
    console.log(JSON.stringify({ channelId, summary, records: db.records.map((r) => ({ key: r.key, status: r.status, title: r.candidate.title, sourceUrl: r.candidate.sourceUrl, rightsEvidenceUrl: r.candidate.rightsEvidenceUrl, licence: r.candidate.license?.type, updatedAt: r.updatedAt })) }, null, 2));
  } else if (command === "show") {
    const r = (await readPlanningInbox(state)).records.find((item) => item.key === key);
    if (!r) throw new Error("Source key not found in this channel's planning inbox.");
    console.log(JSON.stringify(r, null, 2));
  } else if (command === "template") {
    const r = (await readPlanningInbox(state)).records.find((item) => item.key === key);
    if (!r || !draftPath) throw new Error("A source key and output draft path are required.");
    await writeFile(resolve(draftPath), JSON.stringify(makePlanTemplate(r), null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ status: "draft_template_only", outputPath: resolve(draftPath), productionEligible: false }));
  } else if (command === "review") {
    if (!key || !draftPath || !reviewPath || !sourcePath) throw new Error("Review requires key, draft, separate review attestation and the exact reviewed source file.");
    const [draft, review] = await Promise.all([readFile(resolve(draftPath), "utf8").then(JSON.parse), readFile(resolve(reviewPath), "utf8").then(JSON.parse)]);
    const sha256 = await hashSourceFile(resolve(sourcePath));
    const r = await approveReviewedPlan(state, key, draft, review, { checkedSourceSha256: sha256 });
    console.log(JSON.stringify({ status: r.status, candidateId: r.seed.id, sourceSha256: sha256, reviewDigest: r.reviewDigest, uploadApproved: false, audienceReviewed: false }));
  } else if (command === "reject") {
    if (!key || !draftPath || !reviewPath) throw new Error("Reject requires key, reviewer and a specific reason.");
    const r = await rejectPlanningSource(state, key, { reviewedBy: draftPath, reason: reviewPath });
    console.log(JSON.stringify({ key: r.key, status: r.status, reason: r.rejection.reason }));
  } else if (command === "check") {
    const result = await reviewedPlanningSeeds(state, { bootstrapPath });
    console.log(JSON.stringify({ reviewedCandidates: result.seeds.map((s) => s.id), invalid: result.invalid }, null, 2));
    if (result.invalid.length) process.exitCode = 1;
  } else throw new Error(`Unknown command: ${command}\n${usage}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
