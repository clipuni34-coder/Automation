# Platform access required before publishing

Publishing is deliberately disabled. Discovery API keys are not sufficient to publish to user accounts; each platform requires account authorization and app configuration.

## Discovery access limitations

- YouTube public discovery currently uses the official Data API for popular charts and bounded keyword searches. Its search endpoint has a separate daily quota bucket; keep query counts bounded and monitor the Google Cloud quota page.
- TikTok's Research API is not a general-purpose creator trend API. TikTok says Research Tools are for approved qualifying researchers and nonprofit/academic research use; access requires an application and approval. It should not be assumed available to this personal creator workflow.
- TikTok's standard user-authorized video query API is for retrieving videos belonging to the authorizing user; it is not a general public-video search endpoint. The Content Posting API is a separate capability and does not provide broad trend discovery.
- Until an eligible, approved discovery route is available, the system must not claim full TikTok coverage. It can use TikTok references supplied through permitted means and research public trend signals from other sources.

Official references: [YouTube API quota costs](https://developers.google.com/youtube/data/determine_quota_cost), [TikTok Research Tools eligibility](https://developers.tiktok.com/products/research-api/), [TikTok Research API overview](https://developers.tiktok.com/docs/en/about-research-api), [TikTok user video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query).

## YouTube Shorts

- Create a Google Cloud OAuth 2.0 client for the application.
- Obtain offline user authorization for `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/yt-analytics.readonly` (the Analytics reports endpoint also currently requires `https://www.googleapis.com/auth/youtube.readonly`).
- Store `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` and `YOUTUBE_REFRESH_TOKEN` as GitHub Actions secrets; never store them in source files. Enable the YouTube Analytics API and YouTube Data API v3 in the Google Cloud project.
- The repository now has a guarded resumable upload adapter (`npm run youtube-upload -- <publishing-package.json>`) and an optional Analytics sync (`npm run youtube-analytics`). The upload CLI refuses to publish unless `YOUTUBE_AUTO_PUBLISH=true`, the package is explicitly `approved_for_upload`, editorial approval is cleared, visual QC passed, and public posting has the additional `YOUTUBE_ALLOW_PUBLIC_PUBLISH=true` guard. The first upload should remain private/unlisted for verification.
- To enable the scheduled Analytics snapshot after adding the three secrets, set the Actions repository variable `SYNC_YOUTUBE_ANALYTICS=true`. It archives a 30-day analytics snapshot; YouTube Analytics data commonly lags by 48–72 hours.
- The current `YOUTUBE_DATA_API_KEY` is used for public discovery only. It cannot upload videos.
- Upload through the official `videos.insert` endpoint, then poll processing status before reporting success.

Official references: [YouTube videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [Upload a video guide](https://developers.google.com/youtube/v3/guides/uploading_a_video).

## TikTok

- Register a TikTok for Developers app and add the Content Posting API product.
- Request and obtain approval for the `video.publish` scope, then complete OAuth for the creator account.
- Query creator information before initializing a post and honor the privacy options returned by TikTok.
- Direct Post uses the official initialize/upload/status flow. A public URL upload requires verification of the URL domain/prefix; otherwise use the returned file-upload URL.
- Unaudited clients are restricted to private viewing mode. Public posting requires TikTok's audit.
- A user must explicitly approve each post and its privacy setting.

Official references: [Content Posting API setup](https://developers.tiktok.com/docs/en/content-posting-api-get-started), [Direct Post API](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post), [Scopes](https://developers.tiktok.com/docs/en/tiktok-api-scopes).

## Instagram Reels

- Use an Instagram Professional (Creator or Business) account.
- Create a Meta app and complete the applicable Instagram Login or Facebook Login authorization path.
- Request the content-publishing permission for the chosen login path (for example, `instagram_business_content_publish` or `instagram_content_publish`).
- The video must be available to Meta through an accessible media URL or an approved resumable upload flow.
- Create a Reel media container, poll its processing status, then call the publish endpoint.
- A personal consumer account is not sufficient for the Instagram Graph API publishing flow.

Official references: [Meta Instagram API documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/).

## Safety defaults

- No platform receives a video automatically.
- The publisher must check that the current package has rights-cleared assets and a verified MP4.
- The user must explicitly approve the target platform, caption, privacy setting and publish action.
- A successful upload is not treated as a published post until the platform returns a confirmed published state.
- OAuth tokens are stored only as secrets and never logged.
