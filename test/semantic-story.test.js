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
