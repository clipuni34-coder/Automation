import test from "node:test";
import assert from "node:assert/strict";
import { generateEditorialPlan } from "../src/creative/provider.js";

const dossier = {
  topic: "Why octopuses change colour",
  evidence: [{ title: "Research lead", url: "https://example.org", sourceExcerpt: "Unverified excerpt", verification: "unverified_search_excerpt" }]
};

const validPlan = {
  workingTitle: "The colour-changing octopus",
  targetAudience: "Curious science viewers",
  recommendedAngle: "Explain the surprising mechanism without overstating it.",
  alternativeAngles: ["A camouflage mystery", "A biology misconception"],
  hookOptions: ["How can an octopus change colour so fast?", "Its skin does something extraordinary."],
  scriptBeats: [
    { time: "0-3s", purpose: "Hook", narration: "How can an octopus change colour so quickly?", retentionDevice: "Open loop" },
    { time: "3-12s", purpose: "Context", narration: "Start with the visible change.", retentionDevice: "Visual reveal" },
    { time: "12-30s", purpose: "Explain", narration: "Explain only verified mechanisms.", retentionDevice: "Layered explanation" }
  ],
  visualPlan: [{ time: "0-3s", visual: "Original animated colour shift", sourceType: "original_graphic", notes: "Do not reuse reference footage" }],
  callToAction: "Follow for more science explained.",
  claimsToVerify: ["Confirm the biological mechanism with primary sources."],
  originalityNotes: "Original explanation and motion graphics.",
  uncertaintyNotes: "Search excerpts are not verified."
};

test("creative provider fails closed without a configured model key", async () => {
  const result = await generateEditorialPlan({ dossier, geminiApiKey: "", openaiApiKey: "" });
  assert.equal(result.status, "not_configured");
  assert.equal(result.plan, null);
});

test("creative provider returns validated structured plan from Gemini", async () => {
  const fetchImpl = async (url, options) => {
    assert.match(url, /generativelanguage\.googleapis\.com/);
    assert.equal(options.method, "POST");
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] })
    };
  };
  const result = await generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "gemini");
  assert.equal(result.plan.scriptBeats.length, 3);
  assert.equal(result.plan.claimsToVerify[0], validPlan.claimsToVerify[0]);
});

test("creative provider falls back to OpenAI if Gemini fails", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes("generativelanguage")) return { ok: false, status: 503 };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    };
  };
  const result = await generateEditorialPlan({
    dossier, geminiApiKey: "bad-key", openaiApiKey: "fallback-key", fetchImpl
  });
  assert.equal(calls, 2);
  assert.equal(result.provider, "openai");
});

test("creative provider rejects incomplete model output", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ workingTitle: "Incomplete" }) }] } }] })
  });
  await assert.rejects(
    generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl }),
    /missing targetAudience/
  );
});


test("creative provider targets the currently recommended Gemini Flash model", async () => {
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] })
    };
  };
  await generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl });
  assert.match(requestedUrl, /models\/gemini-3\.8-flash:generateContent/);
});
