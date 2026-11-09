// Compare Commons original-file URLs without treating API tracking query
// parameters or Commons' space/underscore spelling as distinct assets.
// Other hosts retain their full URL, including the query string.
export function sourceIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname.toLowerCase() === "upload.wikimedia.org") {
      const path = decodeURIComponent(url.pathname).replace(/ /g, "_");
      return `${url.origin}${path}`;
    }
    return url.href;
  } catch { return null; }
}

export function sameSourceUrl(a, b) {
  const first = sourceIdentity(a);
  return Boolean(first && first === sourceIdentity(b));
}
