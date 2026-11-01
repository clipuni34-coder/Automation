const truthy = new Set(["1", "true", "yes", "on"]);

export function loadConfig(env = process.env) {
  const port = Number.parseInt(env.PORT ?? "3000", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? "development",
    port,
    tavilyApiKey: env.TAVILY_API_KEY ?? "",
    geminiApiKey: env.GEMINI_API_KEY ?? "",
    openaiApiKey: env.OPENAI_API_KEY ?? "",
    requirePublishApproval: env.REQUIRE_PUBLISH_APPROVAL === undefined
      ? true
      : truthy.has(String(env.REQUIRE_PUBLISH_APPROVAL).toLowerCase())
  });
}
