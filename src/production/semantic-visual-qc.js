import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function run(command, args, timeoutMs = 60000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(command + " exited with code " + code + ": " + stderr.slice(-1500)));
    });
  });
}

function parseJson(text) {
  const clean = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(clean);
}

/**
 * Samples a frame from each rendered scene and asks a vision model whether the
 * actual image depicts the planned scene. Missing keys/errors remain unverified.
 */
export async function reviewSceneVisualSemantics(manifest, videoPath, {
  apiKey = process.env.OPENAI_API_KEY ?? "",
  fetchImpl = fetch,
  ffmpegPath = "ffmpeg",
  timeoutMs = 90000
} = {}) {
  const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
  if (!apiKey) return { status: "unverified", provider: null, reviewedScenes: 0, scenes: [], warnings: ["OPENAI_API_KEY is not configured; scene meaning was not visually verified."] };
  if (!scenes.length) return { status: "unverified", provider: "openai", reviewedScenes: 0, scenes: [], warnings: ["No scenes were available for semantic review."] };
  const dir = await mkdtemp(join(tmpdir(), "scene-semantic-qc-"));
  const results = [];
  try {
    for (const [index, scene] of scenes.entries()) {
      const midpoint = Math.max(0, (Number(scene.start) + Number(scene.end)) / 2);
      const framePath = join(dir, "scene-" + (index + 1) + ".jpg");
      // Keep this outside try so the failure handler can always report the scene
      // description even when frame extraction or the OpenAI request fails.
      const description = String(scene.visualDescription ?? scene.narrationContext ?? scene.caption ?? "").slice(0, 700);
      try {
        await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", String(midpoint), "-i", resolve(videoPath), "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "5", "-y", framePath]);
        const bytes = await readFile(framePath);
        if (bytes.length < 1000 || bytes.length > 5 * 1024 * 1024) throw new Error("Sampled frame is empty or too large");
        const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer " + apiKey, "content-type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            temperature: 0,
            max_tokens: 180,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "You are a strict visual quality inspector. Compare the supplied frame with the requested scene description. Do not infer unseen action or context. Return JSON only with relevant (boolean), confidence (0 to 1), observed (short string), reason (short string). Mark relevant false if the image is generic, unrelated, ambiguous, or does not visibly support the requested scene." },
              { role: "user", content: [
                { type: "text", text: "Planned scene: " + description + "\nNarration context: " + String(scene.narrationContext ?? "").slice(0, 700) + "\nDoes this actual frame visibly match the planned scene? Judge only visible evidence." },
                { type: "image_url", image_url: { url: "data:image/jpeg;base64," + bytes.toString("base64"), detail: "low" } }
              ] }
            ]
          }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error("OpenAI vision returned HTTP " + response.status + ": " + (await response.text()).slice(0, 500));
        const payload = await response.json();
        const raw = payload.choices?.[0]?.message?.content;
        const verdict = parseJson(raw);
        const confidence = Math.max(0, Math.min(1, Number(verdict.confidence) || 0));
        const relevant = verdict.relevant === true && confidence >= 0.65;
        results.push({ scene: index + 1, relevant, confidence, observed: String(verdict.observed ?? "").slice(0, 300), reason: String(verdict.reason ?? "").slice(0, 400), description });
      } catch (error) {
        results.push({ scene: index + 1, relevant: false, confidence: 0, error: error.message.slice(0, 500), description });
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const failed = results.filter(item => !item.relevant);
  const warnings = failed.map(item => "Scene " + item.scene + " failed semantic visual verification" + (item.reason ? ": " + item.reason : item.error ? ": " + item.error : "."));
  return { status: failed.length ? "review" : "passed", provider: "openai", model: "gpt-4.1-mini", reviewedScenes: results.length, passedScenes: results.length - failed.length, failedScenes: failed.length, scenes: results, warnings };
}
