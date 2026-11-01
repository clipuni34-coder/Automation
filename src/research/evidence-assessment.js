const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
const DECISIONS = new Set(["supports", "contradicts", "ambiguous", "not_addressed"]);

function safeAssessment(value, claimLedger) {
  if (!value || !Array.isArray(value.assessments)) throw new Error("Evidence assessor returned no assessments array");
  const byId = new Map(claimLedger.claims.map((claim) => [claim.id, claim]));
  const seen = new Set();
  const assessments = [];
  for (const item of value.assessments) {
    if (!byId.has(item.claimId) || seen.has(item.claimId) || !DECISIONS.has(item.decision)) continue;
    seen.add(item.claimId);
    const sourceIds = new Set(byId.get(item.claimId).sources.map((source) => source.id));
    assessments.push({
      decision: item.decision,
      confidence: ["low", "medium", "high"].includes(item.confidence) ? item.confidence : "low",
      rationale: String(item.rationale ?? "").slice(0, 1200),
      evidence: Array.isArray(item.evidence) ? item.evidence.filter((e) => sourceIds.has(e.sourceId)).slice(0, 8).map((e) => ({
        sourceId: e.sourceId,
        relation: DECISIONS.has(e.relation) ? e.relation : "ambiguous",
        passage: String(e.passage ?? "").slice(0, 1000)
      })) : [],
      requiresHumanReview: true,
      verificationDecision: "not_verified"
    });
  }
  return assessments;
}

export async function assessClaimEvidence({
  claimLedger,
  apiKey = process.env.GEMINI_API_KEY ?? "",
  fetchImpl = fetch,
  timeoutMs = 90000
} = {}) {
  if (!claimLedger || !Array.isArray(claimLedger.claims)) throw new Error("A claim ledger is required");
  if (!apiKey) return { status: "not_configured", assessed: 0, claims: [] };
  if (!claimLedger.claims.length) return { status: "no_claims", assessed: 0, claims: [] };

  const input = claimLedger.claims.map((claim) => ({
    claimId: claim.id,
    claim: claim.claim,
    sources: claim.sources.map((source) => ({
      sourceId: source.id,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      extracted: source.extractionStatus === "opened",
      text: String(source.extractedContent || source.sourceExcerpt || "").slice(0, 3000)
    }))
  }));
  const prompt = [
    "Assess whether each supplied source passage directly relates to its associated factual claim.",
    "Return ONLY JSON: {assessments:[{claimId,decision,confidence,rationale,evidence:[{sourceId,relation,passage}]}]}.",
    "decision and relation must be one of supports, contradicts, ambiguous, not_addressed. confidence must be low, medium, or high.",
    "Use supports only when the quoted passage directly supports the exact claim; contradicts only when it directly conflicts; ambiguous for partial, unclear, stale, context-poor or conflicting material; not_addressed when it does not address the claim.",
    "Do not infer from a source title, domain reputation, search relevance score, or unrelated text. Distinguish extracted page text from search snippets. If evidence is missing or noisy, choose not_addressed or ambiguous with low confidence.",
    "Quote short exact passages and cite only supplied sourceIds. Do not invent quotations, sources, dates, or facts. This is an advisory assessment, not verification; all claims still require human review.",
    JSON.stringify(input)
  ].join("\n\n");

  const errors = [];
  for (const model of MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: "Return only valid JSON. Never claim that a factual claim is verified." }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
      const payload = await response.json();
      const raw = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!raw) throw new Error("Gemini returned an empty evidence assessment");
      const parsed = JSON.parse(raw);
      const assessments = safeAssessment(parsed, claimLedger);
      const byId = new Map(assessments.map((item) => [item.claimId, item]));
      const claims = claimLedger.claims.map((claim) => ({
        claimId: claim.id,
        assessment: byId.get(claim.id) ?? {
          decision: "not_addressed", confidence: "low", rationale: "No usable assessment was returned for this claim.",
          evidence: [], requiresHumanReview: true, verificationDecision: "not_verified"
        }
      }));
      return { status: "ok", model, assessed: assessments.length, claims };
    } catch (error) {
      errors.push(`${model}: ${String(error.message ?? error).slice(0, 300)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { status: "failed", assessed: 0, claims: [], error: errors.join("; ").slice(0, 1200) };
}
