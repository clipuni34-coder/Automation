import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSemanticStory } from "../src/creative/semantic-story.js";

test("semantic story analysis is explicitly unavailable when no provider is enabled", async () => {
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { geminiApiKey: "", openaiApiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.equal(result.qualified, false);
});

test("semantic story analysis validates every adjacent transition and accepts clear continuity", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
      fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.91,
      explanation: "The second chunk continues the rescue.", evidence: "They carried the injured climber"
    }] }) } }] })
  });
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.status, "contextually_connected");
  assert.equal(result.qualified, true);
  assert.equal(result.transitions.length, 1);
});

test("semantic story analysis treats uncertain transitions as requiring human review", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
      fromSegmentId: "a", toSegmentId: "b", relationship: "uncertain", confidence: 0.55,
      explanation: "The reference is unclear.", evidence: "They carried the injured"
    }] }) } }] })
  });
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.status, "human_review_required");
  assert.equal(result.qualified, false);
});

test("semantic story analysis accepts empty evidence for a disconnected pair but not a connected pair", async () => {
  const segments = [
    { id: "a", start: 0, end: 2, text: "From the Library of Congress in Washington, D.C." },
    { id: "b", start: 3, end: 5, text: "We all must learn to do." }
  ];
  const disconnectedFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
      fromSegmentId: "a", toSegmentId: "b", relationship: "disconnected", confidence: 0.96,
      explanation: "The chunks do not provide evidence of the same story.", evidence: ""
    }] }) } }] })
  });
  const disconnected = await analyzeSemanticStory(segments, { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl: disconnectedFetch });
  assert.equal(disconnected.status, "human_review_required");
  assert.equal(disconnected.transitions[0].evidence, "");
  assert.equal(disconnected.transitions[0].evidenceSegmentId, null);

  const connectedFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
      fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.96,
      explanation: "Claims continuity without a quote.", evidence: ""
    }] }) } }] })
  });
  const connected = await analyzeSemanticStory(segments, { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl: connectedFetch });
  assert.equal(connected.status, "provider_error");
  assert.equal(connected.qualified, false);
});

test("semantic story analysis rejects incomplete model transition coverage", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [] }) } }] })
  });
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "First chunk." },
    { id: "b", start: 3, end: 5, text: "Second chunk." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.status, "provider_error");
  assert.equal(result.qualified, false);
});

test("semantic story analysis rejects evidence that is not quoted from the transcript", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
      fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.99,
      explanation: "Invented evidence.", evidence: "The helicopter rescued everyone"
    }] }) } }] })
  });
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.status, "provider_error");
  assert.equal(result.qualified, false);
});

test("semantic story analysis declines oversized transcript input before calling a provider", async () => {
  let called = false;
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "x".repeat(1201) },
    { id: "b", start: 3, end: 5, text: "Another segment." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl: async () => { called = true; } });
  assert.equal(result.status, "input_too_large");
  assert.equal(called, false);
});


test("semantic story analysis validates per-moment scores and transcript evidence", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      transitions: [{ fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9, explanation: "Same rescue.", evidence: "They carried the injured climber" }],
      momentAssessments: [
        { segmentId: "a", compellingScore: 8.4, confidence: 0.88, role: "hook", selfContained: false, rationale: "Specific unanswered question.", evidence: "The rescue team, reached the mountain" },
        { segmentId: "b", compellingScore: 9.1, confidence: 0.91, role: "payoff", selfContained: true, rationale: "Clear outcome.", evidence: "They carried the injured climber to safety" }
      ]
    }) } }] })
  });
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.momentAssessmentStatus, "complete");
  assert.equal(result.momentAssessments[1].compellingScore, 9.1);
  assert.equal(result.momentAssessments[1].selfContained, true);
});


test("Gemini semantic analysis retries a transient service error before succeeding", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, text: async () => "temporarily unavailable", headers: { get: () => "" } };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        transitions: [{ fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9, explanation: "Continuation.", evidence: "They carried the injured climber" }],
        momentAssessments: [
          { segmentId: "a", compellingScore: 7, confidence: 0.8, role: "hook", selfContained: false, rationale: "Opens the event.", evidence: "The rescue team reached the mountain" },
          { segmentId: "b", compellingScore: 8, confidence: 0.85, role: "payoff", selfContained: true, rationale: "Shows the result.", evidence: "They carried the injured climber to safety" }
        ]
      }) }] } }] })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { geminiApiKey: "test-key", openaiApiKey: "", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.provider, "gemini");
  assert.equal(result.momentAssessmentStatus, "complete");
});


test("semantic story analysis validates a complete chronological story window", async () => {
  const segments = [
    { id: "a", start: 0, end: 4, text: "Why did the bridge suddenly collapse?" },
    { id: "b", start: 5, end: 9, text: "The support cable snapped during the storm." },
    { id: "c", start: 10, end: 14, text: "Engineers rebuilt the bridge and reopened the road." }
  ];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      transitions: [
        { fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9, explanation: "The cable explains the collapse.", evidence: "support cable snapped during the storm" },
        { fromSegmentId: "b", toSegmentId: "c", relationship: "connected", confidence: 0.92, explanation: "The rebuild resolves the problem.", evidence: "rebuilt the bridge and reopened the road" }
      ],
      momentAssessments: segments.map((segment, index) => ({
        segmentId: segment.id, compellingScore: 8 + index * 0.5, confidence: 0.9,
        role: ["hook", "tension", "payoff"][index], selfContained: index === 2,
        rationale: "Clear story beat.", evidence: segment.text
      })),
      storyWindow: {
        arcStatus: "complete", segmentIds: ["a", "b", "c"],
        hookSegmentId: "a", payoffSegmentId: "c",
        hookEvidence: "Why did the bridge suddenly collapse",
        payoffEvidence: "rebuilt the bridge and reopened the road",
        confidence: 0.91, summary: "A bridge collapses, then engineers restore it.",
        rationale: "The sequence has a clear problem and resolution."
      }
    }) } }] })
  });
  const result = await analyzeSemanticStory(segments, { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(result.storyWindowStatus, "assessed");
  assert.equal(result.storyWindow.arcStatus, "complete");
  assert.equal(result.storyWindow.evidenceValidated, true);
  assert.deepEqual(result.storyWindow.segmentIds, ["a", "b", "c"]);
});


test("semantic story analysis retries once when model evidence fails exact-quote validation", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const evidence = calls === 1 ? "The rescue" : "The rescue team reached the mountain";
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        transitions: [{ fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9, explanation: "Continuation.", evidence: "They carried the injured climber" }],
        momentAssessments: [
          { segmentId: "a", compellingScore: 8, confidence: 0.85, role: "hook", selfContained: false, rationale: "Opens the rescue.", evidence },
          { segmentId: "b", compellingScore: 8.5, confidence: 0.9, role: "payoff", selfContained: true, rationale: "Shows the outcome.", evidence: "They carried the injured climber to safety" }
        ]
      }) } }] })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { openaiApiKey: "test-key", geminiApiKey: "", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.status, "contextually_connected");
  assert.equal(result.momentAssessmentStatus, "complete");
  assert.equal(result.momentAssessments[0].evidence, "The rescue team reached the mountain");
});


test("Gemini semantic analysis retries once after exact-quote evidence validation fails", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const evidence = calls === 1 ? "The rescue" : "The rescue team reached the mountain";
    const payload = {
      transitions: [{ fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9, explanation: "Continuation.", evidence: "They carried the injured climber" }],
      momentAssessments: [
        { segmentId: "a", compellingScore: 8, confidence: 0.85, role: "hook", selfContained: false, rationale: "Opens the rescue.", evidence },
        { segmentId: "b", compellingScore: 8.5, confidence: 0.9, role: "payoff", selfContained: true, rationale: "Shows the outcome.", evidence: "They carried the injured climber to safety" }
      ]
    };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { geminiApiKey: "test-key", openaiApiKey: "", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.provider, "gemini");
  assert.equal(result.status, "contextually_connected");
  assert.equal(result.momentAssessmentStatus, "complete");
  assert.equal(result.momentAssessments[0].evidence, "The rescue team reached the mountain");
});


test("Groq semantic fallback uses its OpenAI-compatible endpoint and validates source evidence", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
        fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9,
        explanation: "The second chunk continues the rescue.", evidence: "They carried the injured climber"
      }] }) } }] })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { geminiApiKey: "", groqApiKey: "test-key", openrouterApiKey: "", openaiApiKey: "", fetchImpl });
  assert.equal(requestedUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(result.provider, "groq");
  assert.equal(result.qualified, true);
});

test("Cloudflare Workers AI semantic fallback parses its REST response envelope", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ success: true, result: { response: JSON.stringify({ transitions: [{
        fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.88,
        explanation: "The second chunk continues the rescue.", evidence: "They carried the injured climber"
      }] }) } })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], {
    geminiApiKey: "", groqApiKey: "", openrouterApiKey: "", openaiApiKey: "",
    cloudflareAccountId: "account-test", cloudflareApiToken: "token-test", fetchImpl
  });
  assert.match(requestedUrl, /accounts\/account-test\/ai\/run\/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast$/);
  assert.equal(result.provider, "cloudflare-workers-ai");
  assert.equal(result.qualified, true);
});


test("OpenRouter free retry leaves provider reasoning enabled when JSON mode returns an empty response", async () => {
  const requestBodies = [];
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    requestBodies.push(JSON.parse(options.body));
    if (calls === 1) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: null, reasoning: "internal reasoning is not the final answer" } }] }) };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ transitions: [{
        fromSegmentId: "a", toSegmentId: "b", relationship: "connected", confidence: 0.9,
        explanation: "The second chunk continues the rescue.", evidence: "They carried the injured climber"
      }] }) } }] })
    };
  };
  const result = await analyzeSemanticStory([
    { id: "a", start: 0, end: 2, text: "The rescue team reached the mountain." },
    { id: "b", start: 3, end: 5, text: "They carried the injured climber to safety." }
  ], { geminiApiKey: "", groqApiKey: "", openrouterApiKey: "test-key", openaiApiKey: "", fetchImpl });
  assert.equal(calls, 2);
  assert.equal(requestBodies[0].response_format.type, "json_object");
  assert.equal("response_format" in requestBodies[1], false);
  assert.equal("reasoning" in requestBodies[1], false);
  assert.equal(result.provider, "openrouter-free");
  assert.equal(result.qualified, true);
});
