import { readFile } from "node:fs/promises";
import { buildDailyPlan, readStrategyHistory, writeStrategyHistory } from "./daily-plan.js";

const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
const strategyPath = process.env.STRATEGY_STORE_PATH ?? "data/strategy.json";
const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
const history = await readStrategyHistory(strategyPath);
const profilesPath = process.env.CHANNEL_PROFILES_PATH ?? "config/channels.json";
let channelProfiles = [];
try {
  const parsedProfiles = JSON.parse(await readFile(profilesPath, "utf8"));
  channelProfiles = Array.isArray(parsedProfiles) ? parsedProfiles : parsedProfiles.channels ?? [];
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const plan = buildDailyPlan({ discovery, history, now: new Date(), channelProfiles });
await writeStrategyHistory(strategyPath, plan);
console.log(JSON.stringify({
  plan: plan.latestPlan,
  strategyStorePath: strategyPath
}, null, 2));
