# Primeplug visible hashtags

## Finding

The saved packages for the two publicly listed Shorts contained hashtag arrays, but the previous uploader converted those values to YouTube's separate `snippet.tags` field without adding them to the public title or description. Those hidden video tags are not equivalent to visible, clickable hashtags. The saved upload descriptions did not contain hashtag lines. Current live descriptions were not independently verified and might have been changed later.

YouTube says hashtags in a title or description are clickable; up to three of the description hashtags may appear beside the title. Hashtags should be relevant and not excessive: https://support.google.com/youtube/answer/6390658?hl=en . They do not guarantee views or resolve copyright concerns.

## Prepared changes

- Future approved YouTube uploads add up to five valid, unique, relevant package hashtags visibly at the end of the description. If the package has none, the Primeplug Shorts path uses `#Shorts`. The separate YouTube tags remain supported.
- Existing descriptions are never silently shortened to make room; the uploader refuses an over-5,000-byte result rather than cut source or licence credits.
- The owner asked for hashtags on the videos. A one-time, explicit `update_primeplug_hashtags` action is prepared for only the two known public Primeplug Shorts: Chiitan (`KBHalqUmHxk`) and Baby Elephants (`dQwD_It3oXM`). Their hashtags are topical and do not assert a child audience. Private NASA videos are not touched.
- The existing-video operation checks the authorized channel identity, verifies each video is public and belongs to Primeplug, reads current metadata, uses an ETag to prevent overwriting concurrent changes, and writes only the `snippet` part. It copies the existing title, category, tags, default language and entire description, appending only missing hashtags. It never sends the `status` part, so it does not set visibility or audience. A re-read checks the description and unchanged metadata. It stops on any error or uncertain result; there is no blind retry.
- This one-time job is separate from the daily production workflow so it does not consume the 06:30 scheduler slot. GitHub OAuth authorization, the repo's existing YouTube OAuth secrets, and permission to update video metadata are required. A successful local mock test or GitHub branch push is not proof that either live description changed.
- The API's `videos.update` method requires appropriate YouTube modification scopes; upload-only credentials may be insufficient: https://developers.google.com/youtube/v3/docs/videos/update .

## Hashtags prepared for the existing public videos

- Chiitan: `#Shorts #Chiitan #FunnyFails #Mascot`
- Baby Elephants: `#Shorts #BabyElephants #FunnyAnimals #Elephants`

Existing description hashtags are preserved. The helper deduplicates case-insensitively and does not add hashtags once five distinct hashtags are already present; it never deletes existing ones.

Local test evidence: 31/31 focused hashtag/audience tests and 399/399 full-suite tests passed with the existing FFmpeg on PATH. Both the YouTube update and upload tests used mocked network responses; they did not modify live videos. The actual one-time metadata update and YouTube OAuth modification scopes remain unverified until a successful, independently re-read live run.
