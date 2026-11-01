import { searchTopic } from "./tavily.js";

export async function buildResearchDossier({
  topic,
  reference = null,
  search = searchTopic
} = {}) {
  const query = String(topic ?? "").trim();
  if (!query) throw new Error("A topic is required");
  const research = await search({ query: `${query} background evidence recent developments` });
  const sources = research.results ?? [];
  return {
    schemaVersion: 1,
    status: research.status,
    topic: query,
    generatedAt: new Date().toISOString(),
    reference: reference ? {
      id: reference.id ?? null,
      title: reference.title ?? null,
      url: reference.sourceUrl ?? null,
      creator: reference.creator ?? null,
      categoryId: reference.categoryId ?? null,
      metrics: reference.metrics ?? null,
      publishedAt: reference.publishedAt ?? null,
      rightsStatus: reference.rightsStatus ?? "reference_only",
      permittedUse: "research_reference_only"
    } : null,
    evidence: sources.map((source, index) => ({
      id: `source-${index + 1}`,
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      searchRelevance: source.score,
      sourceExcerpt: source.content,
      verification: "unverified_search_excerpt"
    })),
    editorial: {
      candidateAngles: [],
      recommendedAngle: null,
      hookOptions: [],
      script: null,
      visualPlan: [],
      callToAction: null,
      status: "awaiting_editorial_reasoning"
    },
    safeguards: [
      "Search excerpts are leads, not independently verified facts.",
      "Verify every factual claim against its original source before scripting or publication.",
      "Do not copy the reference video's script, footage, or distinctive creative expression.",
      "The reference video is metadata for research only; its footage is not licensed by this dossier.",
      "No source results means research is unavailable; do not invent evidence."
    ]
  };
}
