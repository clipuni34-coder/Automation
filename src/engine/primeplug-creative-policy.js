// The Primeplug excerpt pipeline automatically picks source moments and uses
// the source audio. It cannot yet bind an editorial opening review to that
// selected edit or separately clear every underlying audio element. Do not
// let it bypass the narrated-pathway safeguards; hold it for a reviewed plan.
// Other channels and direct tools are unaffected by this channel-specific gate.
export function primeplugCreativePathwayGate(channel, seed) {
  if (channel?.id !== "Primeplug" || seed?.productionMode === "narrated") return { allowed: true };
  return {
    allowed: false,
    outcome: "held_excerpt_creative_review",
    reason: "The legacy excerpt pathway cannot yet verify the selected opening or separately clear all source-audio elements. A reviewed narrated edit plan or an equivalent verified excerpt pathway is required."
  };
}
