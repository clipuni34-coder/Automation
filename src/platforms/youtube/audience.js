// YouTube needs a deliberate, video-specific audience classification.
// An absent or unrecognised selection is NOT a synonym for "not made for
// kids": callers must hold the upload and ask for a review instead.
export function parseReviewedAudience(value) {
  if (value === "made_for_kids") return true;
  if (value === "not_made_for_kids") return false;
  return null;
}

// Only report a value when the owner-authenticated API actually returned a
// boolean. YouTube's effective classification can differ from the owner's
// self-declaration, so preserve both fields instead of conflating them.
export function observedAudienceStatus(status) {
  return {
    selfDeclaredMadeForKids: typeof status?.selfDeclaredMadeForKids === "boolean" ? status.selfDeclaredMadeForKids : null,
    madeForKids: typeof status?.madeForKids === "boolean" ? status.madeForKids : null
  };
}
