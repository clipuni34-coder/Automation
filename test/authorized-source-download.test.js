import test from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, isAllowedHostname, validateSourceUrl, downloadAuthorizedSource } from "../scripts/download-authorized-source.js";

test("network guard blocks private, loopback, link-local and reserved IP ranges", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.2", "169.254.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("192.0.66.1"), true, "public 192.0/16 address outside IANA special-use blocks");
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("host allowlist matches exact hosts and subdomains but not lookalike suffixes", () => {
  assert.equal(isAllowedHostname("www.dropbox.com", ["dropbox.com"]), true);
  assert.equal(isAllowedHostname("dropboxusercontent.com", ["dropbox.com"]), false);
  assert.equal(isAllowedHostname("evil-dropbox.com", ["dropbox.com"]), false);
});

test("source URL validator requires HTTPS, an allowlisted host and public DNS answers", async () => {
  const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
  const privateLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  const url = await validateSourceUrl("https://media.example/video.mp4", ["media.example"], publicLookup);
  assert.equal(url.hostname, "media.example");
  await assert.rejects(() => validateSourceUrl("http://media.example/video.mp4", ["media.example"], publicLookup), /HTTPS/);
  await assert.rejects(() => validateSourceUrl("https://not-allowed.example/video.mp4", ["media.example"], publicLookup), /not on/);
  await assert.rejects(() => validateSourceUrl("https://media.example/video.mp4", ["media.example"], privateLookup), /non-public/);
});

test("downloader validates every redirect and enforces media type and size", async () => {
  const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://cdn.media.example/file.mp4" } });
    return new Response(new Uint8Array(2048), { status: 200, headers: { "content-type": "video/mp4", "content-length": "2048" } });
  };
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "media-download-test-"));
  try {
    const output = join(dir, "video.mp4");
    const result = await downloadAuthorizedSource("https://media.example/file.mp4", output, {
      allowedHosts: ["media.example"], maxBytes: 4096, fetchImpl, resolveHost
    });
    assert.equal(result.bytes, 2048);
    assert.equal((await readFile(output)).length, 2048);
    assert.deepEqual(calls, ["https://media.example/file.mp4", "https://cdn.media.example/file.mp4"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloader refuses redirects outside the allowlist", async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
  const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(() => downloadAuthorizedSource("https://media.example/file.mp4", "/tmp/should-not-exist.mp4", {
    allowedHosts: ["media.example"], fetchImpl, resolveHost
  }), /not on/);
});


test("downloader accepts Ogg Theora/Vorbis media containers", async () => {
  const resolveHost = async () => [{ address: "8.8.8.8", family: 4 }];
  const fetchImpl = async () => new Response(new Uint8Array(2048), { status: 200, headers: { "content-type": "application/ogg" } });
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "ogg-download-test-"));
  try {
    const result = await downloadAuthorizedSource("https://media.example/final-approach.ogv", join(dir, "source.ogv"), {
      allowedHosts: ["media.example"], maxBytes: 4096, fetchImpl, resolveHost
    });
    assert.equal(result.contentType, "application/ogg");
    assert.equal(result.bytes, 2048);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
