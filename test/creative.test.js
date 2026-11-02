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
  fullScript: "How does an octopus change colour so quickly? Its skin contains specialised structures that can change how light is reflected. Scientists study these mechanisms to understand camouflage and communication. The surprising part is that colour change is only one part of a much richer visual system. Follow for more science explained.",
  estimatedDurationSeconds: 35,
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
  assert.match(result.plan.fullScript, /octopus/i);
  assert.equal(result.plan.estimatedDurationSeconds, 35);
  assert.equal(result.plan.claimsToVerify[0], validPlan.claimsToVerify[0]);
});

test("creative provider falls back to OpenAI if Gemini fails", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (url.includes("generativelanguage")) return { ok: false, status: 400, text: async () => "Invalid request" };
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

test("creative provider retries a busy Gemini model and falls back to another Flash model", async () => {
  const requestedModels = [];
  const fetchImpl = async (url) => {
    const model = url.split("/models/")[1]?.split(":")[0];
    requestedModels.push(model);
    if (model === "gemini-3.8-flash") {
      return { ok: false, status: 503, text: async () => "temporarily unavailable" };
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] })
    };
  };
  const result = await generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "gemini");
  assert.deepEqual(requestedModels, ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash"]);
});

test("creative provider falls back to the next Gemini model after a timeout", async () => {
  const requestedModels = [];
  const fetchImpl = async (url) => {
    const model = url.split("/models/")[1]?.split(":")[0];
    requestedModels.push(model);
    if (model === "gemini-3.8-flash") {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] })
    };
  };
  const result = await generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl });
  assert.equal(result.status, "ok");
  assert.deepEqual(requestedModels, ["gemini-3.8-flash", "gemini-3.6-flash"]);
});

test("creative provider stops Gemini retries on exhausted daily quota and uses configured OpenAI fallback", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("generativelanguage")) {
      return {
        ok: false, status: 429,
        text: async () => JSON.stringify({
          error: { status: "RESOURCE_EXHAUSTED", message: "Generate content requests per day limit exceeded on Free Tier. Please retry in 3h." }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    };
  };
  const result = await generateEditorialPlan({
    dossier, geminiApiKey: "gemini-key", openaiApiKey: "openai-key", fetchImpl
  });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "openai");
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((url) => url.includes("generativelanguage")).length, 2);
});

test("creative provider reports quota exhaustion without repeated Gemini model calls when no fallback is configured", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false, status: 429,
      text: async () => "RESOURCE_EXHAUSTED: daily quota exceeded; retry in 4h"
    };
  };
  await assert.rejects(
    generateEditorialPlan({ dossier, geminiApiKey: "gemini-key", fetchImpl }),
    /primary quota exhausted/
  );
  assert.equal(calls, 2);
});

test("creative provider uses Gemini Flash-Lite when the primary model daily quota is exhausted", async () => {
  const models = [];
  const fetchImpl = async (url) => {
    const model = url.split("/models/")[1]?.split(":")[0];
    models.push(model);
    if (model === "gemini-3.8-flash") return { ok: false, status: 429, text: async () => "RESOURCE_EXHAUSTED: daily quota exceeded" };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] }) };
  };
  const result = await generateEditorialPlan({ dossier, geminiApiKey: "test-key", fetchImpl });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "gemini");
  assert.deepEqual(models, ["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
});

test("creative briefs are written in the configured output language despite foreign-language source titles", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] }) };
  };
  await generateEditorialPlan({ dossier: { topic: "Korean-language source title" }, geminiApiKey: "test-key", outputLanguage: "English", fetchImpl });
  assert.match(requestBody.contents[0].parts[0].text, /Write every field in English/);
});

test("creative provider uses the OpenRouter free-model router when it is the only configured provider", async () => {
  let request;
  const result = await generateEditorialPlan({
    dossier, geminiApiKey: "", openaiApiKey: "", openrouterApiKey: "openrouter-test-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPlan) } }] }), { status: 200 });
    }
  });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "openrouter-free");
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer openrouter-test-key");
  assert.equal(JSON.parse(request.options.body).model, "openrouter/free");
});

test("OpenRouter creative fallback refuses paid models", async () => {
  await assert.rejects(generateEditorialPlan({
    dossier, geminiApiKey: "", openaiApiKey: "", openrouterApiKey: "test-key",
    openrouterModel: "openai/gpt-4.1",
    fetchImpl: async () => { throw new Error("A paid request must never be made"); }
  }), /restricted to explicitly free models/);
});

test("creative provider falls back to OpenRouter free model after Gemini and OpenAI fail", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.includes("generativelanguage")) return new Response("quota exceeded", { status: 429 });
    if (url.includes("api.openai.com")) return new Response(JSON.stringify({ error: { message: "insufficient_quota" } }), { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validPlan) } }] }), { status: 200 });
  };
  const result = await generateEditorialPlan({
    dossier, geminiApiKey: "gemini-key", openaiApiKey: "openai-key", openrouterApiKey: "router-key", fetchImpl
  });
  assert.equal(result.provider, "openrouter-free");
  assert.equal(calls.at(-1), "https://openrouter.ai/api/v1/chat/completions");
});

test("creative provider uses Gemini Flash-Lite after all primary Flash models hit a transient outage", async () => {
  const requestedModels = [];
  const fetchImpl = async (url) => {
    const model = url.split("/models/")[1]?.split(":")[0];
    requestedModels.push(model);
    if (model !== "gemini-3.5-flash-lite") {
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => "temporarily unavailable" };
    }
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validPlan) }] } }] })
    };
  };
  const result = await generateEditorialPlan({
    dossier, geminiApiKey: "test-key", fetchImpl, sleepImpl: async () => {}
  });
  assert.equal(result.status, "ok");
  assert.equal(result.provider, "gemini");
  assert.deepEqual(requestedModels, [
    "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash",
    "gemini-3.6-flash", "gemini-3.6-flash", "gemini-3.6-flash",
    "gemini-3.5-flash-lite"
  ]);
});

