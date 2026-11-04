import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0));
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value.startsWith("::ffff:")) return isPublicAddress(value.slice(7));
    return !(value === "::" || value === "::1" || value.startsWith("fc") ||
      value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") ||
      value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff"));
  }
  return false;
}

export function isAllowedHostname(hostname, allowedHosts) {
  const host = String(hostname).toLowerCase().replace(/\\.$/, "");
  return allowedHosts.some((entry) => {
    const allowed = String(entry).trim().toLowerCase().replace(/^\\*\\./, "").replace(/\\.$/, "");
    return allowed && (host === allowed || host.endsWith("." + allowed));
  });
}

export async function validateSourceUrl(value, allowedHosts, resolveHost = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Source URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Source URL must be HTTPS and cannot contain embedded credentials");
  if (isIP(url.hostname) || !isAllowedHostname(url.hostname, allowedHosts)) throw new Error("Source host is not on MEDIA_SOURCE_ALLOWED_HOSTS");
  const addresses = await resolveHost(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
    throw new Error("Source host resolves to a non-public or invalid network address");
  }
  return url;
}

export async function downloadAuthorizedSource(sourceUrl, destination, {
  allowedHosts = [],
  maxBytes = 2 * 1024 * 1024 * 1024,
  fetchImpl = fetch,
  resolveHost = lookup,
  maxRedirects = 5
} = {}) {
  if (!allowedHosts.length) throw new Error("MEDIA_SOURCE_ALLOWED_HOSTS must contain at least one approved media host");
  let current = sourceUrl;
  let response;
  for (let redirect = 0; redirect <= maxRedirects; redirect++) {
    const url = await validateSourceUrl(current, allowedHosts, resolveHost);
    response = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(30 * 60 * 1000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new Error("Source download exceeded the redirect limit");
      current = new URL(location, url).toString();
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body) throw new Error("Source host did not return a downloadable media file");
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(contentType.startsWith("video/") || contentType === "application/ogg" || contentType === "application/octet-stream" || contentType === "binary/octet-stream")) {
    throw new Error("Source response is not a video or binary media file");
  }
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error("Source video exceeds the configured size limit");
  const output = resolve(destination);
  const temporary = output + ".partial";
  await mkdir(dirname(output), { recursive: true });
  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error("Source video exceeded the configured size limit while downloading"));
      else callback(null, chunk);
    }
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(temporary, { flags: "w" }));
    if (received < 1024) throw new Error("Downloaded source is too small to be a valid video");
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: output, bytes: received, contentType };
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  try {
    const sourceUrl = process.env.REPURPOSE_SOURCE_URL;
    const destination = process.env.REPURPOSE_SOURCE_PATH ?? "work/source-media";
    const allowedHosts = (process.env.MEDIA_SOURCE_ALLOWED_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const maxBytes = Number(process.env.MEDIA_MAX_UPLOAD_MB ?? 2048) * 1024 * 1024;
    const result = await downloadAuthorizedSource(sourceUrl, destination, { allowedHosts, maxBytes });
    console.log(JSON.stringify({ status: "downloaded", path: result.path, bytes: result.bytes, contentType: result.contentType }));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
