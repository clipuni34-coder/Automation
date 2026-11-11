// Explicit editorial review commands. None of these commands publishes,
// changes channel settings, or automatically certifies AI-generated text.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openChannelState } from "../src/engine/state.js";
import { approveReviewedPlan, hashSourceFile, ingestPlanningCandidates, ingestPixabayLeads, makePlanTemplate, planningSummary, readPlanningInbox, rejectPlanningSource, reviewedPlanningSeeds, sourceKey } from "../src/engine/planning-inbox.js";
import { pixabayLeadKey, searchPixabayForReview } from "../src/discovery/sources/pixabay-planning.js";
import { searchPixabayShared } from "../src/discovery/sources/pixabay-shared-search.js";
import { observePixabayLead } from "../src/engine/pixabay-observations.js";
import { downloadPixabayForReview } from "../src/engine/pixabay-review-download.js";

const root = resolve(process.env.STATE_DIR ?? "data/state");
const channelId = process.env.PLANNING_CHANNEL_ID ?? "Primeplug";
const [command = "help", key, draftPath, reviewPath, sourcePath] = process.argv.slice(2);
const state = await openChannelState(root, channelId);
// The checked-in examples were prepared by the assistant using sampled
// frames, not independently reviewed by a human. They are references only;
// no command implicitly imports their old reviews into state.
async function summarizePixabayLeads(leads) {
  const inbox = await readPlanningInbox(state);
  return leads.map((lead) => {
    const sourceKey = pixabayLeadKey(lead.providerAssetId);
    const record = inbox.records.find((item) => item.key === sourceKey);
    return { sourceKey, provider: "Pixabay", providerAssetId: lead.providerAssetId, title: lead.title, creator: lead.creator,
      itemPageUrl: lead.rightsEvidenceUrl, renditionUrl: lead.sourceUrl, inboxStatus: record?.status ?? "not_saved", productionEligible: false };
  });
}
const usage = `Primeplug planning review (no upload)\n\nSTATE_DIR=state node scripts/planning-inbox.mjs list\nSTATE_DIR=state node scripts/planning-inbox.mjs stage-example <source-key>\nSTATE_DIR=state node scripts/planning-inbox.mjs show <source-key>\nSTATE_DIR=state node scripts/planning-inbox.mjs template <source-key> <draft.json>\nSTATE_DIR=state node scripts/planning-inbox.mjs review <source-key> <draft.json> <review.json> <reviewed-source-file>\nSTATE_DIR=state node scripts/planning-inbox.mjs reject <source-key> <reviewer> <reason>\nSTATE_DIR=state node scripts/planning-inbox.mjs search-pixabay "funny animals"\nSTATE_DIR=state node scripts/planning-inbox.mjs search-pixabay-shared "funny animals"\nSTATE_DIR=state node scripts/planning-inbox.mjs list-pixabay\nSTATE_DIR=state node scripts/planning-inbox.mjs inspect-pixabay <source-key> [local-source-file]\nSTATE_DIR=state node scripts/planning-inbox.mjs download-pixabay-review <source-key> <new-file.mp4>\n\nPixabay search is a bounded operator-initiated lead search, cached 24 hours. The shared search PUSHES a dedicated cache branch and requires separate remote authorization, a verified clock and prior setup. Inspect observes metadata only. A single-asset review download requires explicit authorization and current terms review; it does not approve production or upload. Pixabay leads remain blocked. Before reviewing any source: inspect the exact file and complete source window, verify each claim and rights terms, and fill the separate review.json. Review only promotes an eligible production candidate; it is not upload approval. See docs/PRIMEPLUG_PLANNING.md.`;
try {
  if (channelId !== "Primeplug") throw new Error("This planning workflow is restricted to the Primeplug channel.");
  if (command === "help") console.log(usage);
  else if (command === "search-pixabay") {
    if (!key || draftPath || reviewPath || sourcePath) throw new Error('Provide one quoted, operator-chosen search, for example: search-pixabay "funny animals".');
    if (process.env.PIXABAY_LOCAL_ONLY_CONFIRMED !== "true") throw new Error("Single-checkout search requires PIXABAY_LOCAL_ONLY_CONFIRMED=true only after verifying this key is not used by any other checkout, app or shared cache.");
    if (process.env.PIXABAY_CLOCK_VERIFIED !== "true") throw new Error("A reliable, independently checked runner clock is required before using the 24-hour cache.");
    const search = await searchPixabayForReview(state, key);
    const intake = await ingestPixabayLeads(state, search.leads);
    console.log(JSON.stringify({ status: "unverified_leads_only", provider: "pixabay", cached: search.cached, fetchedAt: search.fetchedAt, found: search.leads.length, ...intake,
      leads: await summarizePixabayLeads(search.leads),
      reminder: "No source, individual licence or third-party rights were approved. Pixabay leads cannot enter production until provider-specific verification is implemented." }, null, 2));
  } else if (command === "search-pixabay-shared") {
    if (!key || draftPath || reviewPath || sourcePath) throw new Error('Provide one quoted, operator-chosen search, for example: search-pixabay-shared "funny animals".');
    const search = await searchPixabayShared({ query: key, repository: resolve("."),
      authorized: process.env.PIXABAY_SHARED_SEARCH_AUTHORIZED === "true", clockVerified: process.env.PIXABAY_CLOCK_VERIFIED === "true" });
    const intake = await ingestPixabayLeads(state, search.leads);
    console.log(JSON.stringify({ status: "unverified_leads_only", provider: "pixabay", cacheMode: search.cacheMode, cacheHead: search.cacheHead,
      cached: search.cached, providerRequestSent: search.providerRequestSent, fetchedAt: search.fetchedAt, found: search.leads.length, ...intake,
      leads: await summarizePixabayLeads(search.leads),
      reminder: "No individual licence, visual claims, third-party rights, production or upload were approved. Persist the inbox separately; do not reset the shared cache." }, null, 2));
  } else if (command === "list-pixabay") {
    if (key || draftPath || reviewPath || sourcePath) throw new Error("List-pixabay takes no arguments.");
    const records = (await readPlanningInbox(state)).records.filter((item) => item.candidate?.provider === "pixabay");
    console.log(JSON.stringify({ provider: "Pixabay", productionEligible: false, records: records.map((item) => ({ sourceKey: item.key, status: item.status,
      providerAssetId: item.candidate.providerAssetId, title: item.candidate.title, creator: item.candidate.creator,
      itemPageUrl: item.candidate.rightsEvidenceUrl, renditionUrl: item.candidate.sourceUrl })) }, null, 2));
  } else if (command === "download-pixabay-review") {
    if (!key || !draftPath || reviewPath || sourcePath) throw new Error("Provide one source key and one new .mp4 review-file path.");
    const record = (await readPlanningInbox(state)).records.find((item) => item.key === key);
    if (!record || record.status !== "awaiting_review" || record.candidate?.provider !== "pixabay") throw new Error("An awaiting-review Pixabay lead is required.");
    const result = await downloadPixabayForReview(record.candidate, draftPath, {
      authorized: process.env.PIXABAY_REVIEW_DOWNLOAD_AUTHORIZED === "true",
      termsReviewed: process.env.PIXABAY_TERMS_REVIEWED === "true", clockVerified: process.env.PIXABAY_CLOCK_VERIFIED === "true"
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "downloaded_for_inspection_only") process.exitCode = 1;
  } else if (command === "inspect-pixabay") {
    if (!key || reviewPath || sourcePath) throw new Error("Inspect requires one source key and an optional local source file.");
    const record = (await readPlanningInbox(state)).records.find((item) => item.key === key);
    if (!record || record.status !== "awaiting_review" || record.candidate?.provider !== "pixabay") throw new Error("An awaiting-review Pixabay lead is required.");
    const report = await observePixabayLead(record.candidate, { sourceFile: draftPath ? resolve(draftPath) : null });
    console.log(JSON.stringify(report, null, 2));
    if (report.observationStatus === "needs_investigation") process.exitCode = 1;
  } else if (command === "stage-example") {
    if (!/^[a-f0-9]{24}$/.test(String(key ?? "")) || draftPath || reviewPath || sourcePath) throw new Error("Provide one exact example source key.");
    const examples = JSON.parse(await readFile(resolve("config/primeplug-reviewed-backlog.json"), "utf8"));
    if (examples?.version !== 1 || !Array.isArray(examples.records)) throw new Error("The example catalog is invalid.");
    const matches = examples.records.filter((item) => item.key === key);
    // Stage the source only. Do not validate the legacy assistant review as a
    // current approval: new human/full-footage attestations are required.
    const candidate = matches[0]?.candidate;
    if (matches.length !== 1 || sourceKey(candidate?.sourceUrl) !== key || candidate?.id !== `planned-${key}`) throw new Error("The selected example source is missing or has a mismatched identity.");
    const intake = await ingestPlanningCandidates(state, [candidate]);
    console.log(JSON.stringify({ status: intake.added === 1 ? "example_staged_for_fresh_human_review" : "example_not_staged", sourceKey: key, ...intake,
      productionEligible: false, uploadApproved: false, reminder: "No assistant-authored plan or review was imported; inspect the exact footage and freshly review its rights and claims. Existing rejections are not overwritten." }, null, 2));
  } else if (command === "list") {
    const db = await readPlanningInbox(state);
    const summary = await planningSummary(state);
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
    const result = await reviewedPlanningSeeds(state);
    console.log(JSON.stringify({ reviewedCandidates: result.seeds.map((s) => s.id), invalid: result.invalid }, null, 2));
    if (result.invalid.length) process.exitCode = 1;
  } else throw new Error(`Unknown command: ${command}\n${usage}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
