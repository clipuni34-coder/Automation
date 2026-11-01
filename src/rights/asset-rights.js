const APPROVED_RIGHTS = new Set(["owned_by_user", "permission_granted", "licensed", "public_domain"]);

export function assessAssetRights(asset, { platform = null, now = new Date() } = {}) {
  const reasons = [];
  if (!asset || typeof asset !== "object") return { allowed: false, status: "blocked", reasons: ["Asset record is missing"] };
  const rightsStatus = String(asset.rightsStatus ?? "unknown");
  if (!APPROVED_RIGHTS.has(rightsStatus)) reasons.push("Rights status is not approved");
  if (rightsStatus === "permission_granted" || rightsStatus === "licensed" || rightsStatus === "public_domain") {
    if (!asset.rightsEvidenceUrl && !asset.rightsEvidenceReference) reasons.push("Permission/license evidence reference is missing");
  }
  if (asset.sourceUrl) {
    try { if (new URL(asset.sourceUrl).protocol !== "https:") reasons.push("Source URL must use HTTPS"); }
    catch { reasons.push("Source URL is invalid"); }
  } else reasons.push("Original source URL is missing");
  if (asset.rightsEvidenceUrl) {
    try { if (new URL(asset.rightsEvidenceUrl).protocol !== "https:") reasons.push("Rights evidence URL must use HTTPS"); }
    catch { reasons.push("Rights evidence URL is invalid"); }
  }
  if (platform && Array.isArray(asset.allowedPlatforms) && !asset.allowedPlatforms.includes(platform)) reasons.push("Asset is not cleared for the requested platform");
  if (platform && !Array.isArray(asset.allowedPlatforms)) reasons.push("Allowed platforms are not documented");
  if (asset.expiresAt) {
    const expiry = Date.parse(asset.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) reasons.push("Asset permission/license is expired or has an invalid expiry");
  }
  return { allowed: reasons.length === 0, status: reasons.length ? "blocked" : "approved", rightsStatus, reasons };
}

export function assertAssetRights(asset, options = {}) {
  const assessment = assessAssetRights(asset, options);
  if (!assessment.allowed) throw new Error("Asset rights check failed: " + assessment.reasons.join("; "));
  return assessment;
}
