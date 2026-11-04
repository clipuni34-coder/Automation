# AI provider setup

The creative pipeline can use multiple text-model providers. Provider adapters are tested with mocked HTTP responses; this does not prove that an account key, quota, billing state, or live endpoint is working.

## Provider order

For semantic story analysis:

1. Gemini, when explicitly enabled.
2. Groq, when explicitly enabled.
3. OpenRouter's free-model router.
4. Cloudflare Workers AI, when explicitly enabled.
5. OpenAI, when explicitly enabled.

For creative briefs, the free OpenRouter route is attempted before optional OpenAI so a paid OpenAI request is not made when the free route is configured and working.

Every provider response is parsed and checked against source transcript evidence. A provider failure does not turn heuristic analysis into semantic understanding; the pipeline remains on human review when semantic analysis is unavailable.

## GitHub repository secrets

Add only the provider credentials you intend to use under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio / Gemini |
| `GROQ_API_KEY` | Groq API |
| `OPENROUTER_API_KEY` | OpenRouter free-model router |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers AI token |
| `OPENAI_API_KEY` | Optional OpenAI fallback |

Never put API keys in repository files, commits, workflow YAML, or chat messages.

## Explicit opt-in variables

Under **Settings → Secrets and variables → Actions → Variables**, set these to `true` only when you intentionally want that provider called:

- `ENABLE_GEMINI_CREATIVE`
- `ENABLE_GROQ_CREATIVE`
- `ENABLE_CLOUDFLARE_CREATIVE`
- `ENABLE_OPENAI_CREATIVE`

They default to `false`. A secret by itself does not enable these providers in the real-footage workflow. OpenRouter is pinned to `openai/gpt-oss-120b:free` and is only called when `OPENROUTER_API_KEY` exists; the code rejects a paid OpenRouter model route.

## Cost and quota cautions

- **Gemini:** free and paid quotas differ by model, region, and account. Check the Google AI Studio project quota before enabling it.
- **Groq:** model availability and rate limits depend on the account and plan. Confirm the current Groq console limits and pricing before enabling it; do not assume every API call is free.
- **OpenRouter:** this integration pins the router to `openai/gpt-oss-120b:free`. Free-model availability and limits can change, and requests may fail when providers are busy.
- **Cloudflare Workers AI:** the Free plan includes 10,000 Neurons per day. On Workers Paid, usage above the daily free allocation is billed. Keep `ENABLE_CLOUDFLARE_CREATIVE=false` unless you have checked the account plan and are comfortable with its limits.
- **OpenAI:** optional and disabled by default; use only if its account has usable quota and you accept its pricing.

## Default model IDs

- Groq: `openai/gpt-oss-120b`
- Cloudflare Workers AI: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- OpenRouter: `openai/gpt-oss-120b:free`

The Groq and Cloudflare model IDs are configurable with `GROQ_MODEL` and `CLOUDFLARE_MODEL`. The OpenRouter model is deliberately pinned to the free route in the GitHub workflows.

## Provider dashboards and documentation

- Google AI Studio: https://aistudio.google.com/
- Gemini API quotas and pricing: https://ai.google.dev/gemini-api/docs/pricing
- Groq console: https://console.groq.com/
- Groq supported models: https://console.groq.com/docs/models
- OpenRouter keys and model routing: https://openrouter.ai/
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cloudflare model catalog: https://developers.cloudflare.com/workers-ai/models/
- OpenAI API platform: https://platform.openai.com/

## Verification status

The automated test suite validates provider request formats, response parsing, source-quote validation, fallback order, and fail-closed behavior using mocked API responses. Live API verification requires valid credentials and remaining quota; never interpret a green unit-test run as proof that a provider account is live or free.
