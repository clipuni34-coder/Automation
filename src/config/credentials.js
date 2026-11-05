// Credential readiness audit — reports NAMES and configured/missing status only.
// It never reads, prints, hashes, or returns a credential value.

export const CREDENTIAL_SPECS = [
  { name: "YOUTUBE_DATA_API_KEY", purpose: "YouTube discovery (Data API v3)", requiredFor: ["discovery"] },
  { name: "YOUTUBE_CLIENT_ID", purpose: "YouTube OAuth upload/analytics", requiredFor: ["youtube_upload", "youtube_analytics"] },
  { name: "YOUTUBE_CLIENT_SECRET", purpose: "YouTube OAuth (optional for some client types)", requiredFor: [], aliases: [] },
  { name: "YOUTUBE_REFRESH_TOKEN", purpose: "YouTube OAuth refresh token", requiredFor: ["youtube_upload", "youtube_analytics"], aliases: ["REFRESH_TOKEN"] },
  { name: "YOUTUBE_EXPECTED_CHANNEL_ID", purpose: "Fail-closed channel identity check before upload", requiredFor: ["youtube_upload"] },
  { name: "TAVILY_API_KEY", purpose: "Research dossiers", requiredFor: ["research"] },
  { name: "PIXABAY_API_KEY", purpose: "Rights-cleared stock footage search", requiredFor: ["stock_footage"] },
  { name: "GEMINI_API_KEY", purpose: "Gemini creative/TTS/vision (opt-in)", requiredFor: [] },
  { name: "GROQ_API_KEY", purpose: "Groq creative fallback (opt-in)", requiredFor: [] },
  { name: "OPENROUTER_API_KEY", purpose: "OpenRouter free-model creative/vision", requiredFor: [], aliases: ["OPENROUTER_API"] },
  { name: "OPENAI_API_KEY", purpose: "OpenAI creative/vision (opt-in, off by default)", requiredFor: [] },
];

export function auditCredentials(env = process.env) {
  const results = CREDENTIAL_SPECS.map((spec) => {
    const names = [spec.name, ...(spec.aliases ?? [])];
    const configuredVia = names.find((n) => typeof env[n] === "string" && env[n].trim().length > 0) ?? null;
    return {
      name: spec.name,
      purpose: spec.purpose,
      requiredFor: spec.requiredFor,
      configured: Boolean(configuredVia),
      configuredVia, // name only — never the value
      acceptedNames: names,
    };
  });
  const byCapability = {};
  for (const cap of ["discovery", "research", "stock_footage", "youtube_upload", "youtube_analytics"]) {
    const needed = results.filter((r) => r.requiredFor.includes(cap));
    byCapability[cap] = {
      ready: needed.every((r) => r.configured),
      missing: needed.filter((r) => !r.configured).map((r) => r.name),
    };
  }
  return { credentials: results, capabilities: byCapability, valuesExposed: false };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const report = auditCredentials();
  console.log(JSON.stringify(report, null, 2));
  // Exit 0 always: this is a readiness report, not a gate. Callers inspect .capabilities.
}
