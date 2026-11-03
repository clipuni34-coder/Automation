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
      explanation: "The reference is unclear.", evidence: "they"
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
