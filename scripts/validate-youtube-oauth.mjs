// Opt-in, read-only YouTube credential probe. Refreshing a token and checking
// the one authorized channel does not authorize an upload or prove that a
// particular video's audience, rights, content or upload scope is acceptable.
// Never print credential values, provider error bodies or an access token.
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

const expected = String(process.env.YOUTUBE_EXPECTED_CHANNEL_ID ?? "").trim();
if (!/^UC[A-Za-z0-9_-]{22}$/.test(expected)) {
  console.error("YouTube OAuth check held: a valid expected channel ID is required before any credential request.");
  process.exitCode = 1;
} else {
  // These exact endpoints are the only network destinations allowed by the
  // probe. Redirects are refused so credentials cannot follow another host.
  const safeFetch = async (value, options = {}) => {
    const url = new URL(value);
    const allowed = (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token" && !url.search)
      || (url.origin === "https://www.googleapis.com" && url.pathname === "/youtube/v3/channels" && url.searchParams.get("part") === "id,snippet" && url.searchParams.get("mine") === "true"
        && [...url.searchParams.keys()].sort().join(",") === "mine,part");
    if (!allowed || url.username || url.password || url.hash) throw new Error("Unexpected OAuth probe destination.");
    return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
  };
  try {
    const { accessToken } = await refreshYouTubeAccessToken({ fetchImpl: safeFetch });
    const channel = await getAuthorizedYouTubeChannel({ accessToken, fetchImpl: safeFetch });
    const matches = channel.channelId === expected;
    console.log(JSON.stringify({ status: matches ? "channel_identity_verified" : "channel_mismatch", expectedChannelConfigured: true,
      channelMatchesExpected: matches, uploadAttempted: false, publicationApproved: false,
      note: "Identity check only; no upload or video-level rights/audience approval was performed." }));
    if (!matches) process.exitCode = 1;
  } catch (error) {
    const message = String(error?.message ?? "");
    const category = /\binvalid_client\b/i.test(message) ? "invalid_client" : /\binvalid_grant\b/i.test(message) ? "invalid_grant" : "unavailable_or_unverified";
    console.error(JSON.stringify({ status: "held", category, uploadAttempted: false, publicationApproved: false,
      note: "OAuth refresh or channel verification failed. Provider messages and credential values are not logged." }));
    process.exitCode = 1;
  }
}
