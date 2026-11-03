import { assertAssetRights } from "../rights/asset-rights.js";

function conciseCaption(value, fallback = "Watch what happens") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0];
