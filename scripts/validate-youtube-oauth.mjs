// Live YouTube OAuth validation — runs only inside GitHub Actions where the
// secrets exist. Refreshes the access token and verifies the authorized
// channel matches YOUTUBE_EXPECTED_CHANNEL_ID. Prints no credential values.
import { refreshYouTubeAccessToken, getAuthorizedYouTubeChannel } from "../src/platforms/youtube/publisher.js";

const { accessToken } = await refreshYouTubeAccessToken();
console.log("OAuth token refresh: OK (access token not shown)");
const channel = await getAuthorizedYouTubeChannel({ accessToken });
const expected = process.env.YOUTUBE_EXPECTED_CHANNEL_ID ?? "";
const matches = expected ? channel.channelId === expected : null;
console.log(JSON.stringify({ channelId: channel.channelId, channelTitle: channel.title, expectedChannelConfigured: Boolean(expected), channelMatchesExpected: matches }, null, 2));
if (matches === false) {
  console.error("Authorized channel does NOT match YOUTUBE_EXPECTED_CHANNEL_ID — uploads would be blocked.");
  process.exit(1);
}
console.log("YouTube OAuth validation: OK");
