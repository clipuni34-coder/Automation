import { readFile } from "node:fs/promises";
import { buildDailyPlan, readStrategyHistory, writeStrategyHistory } from "./daily-plan.js";

const discoveryPath = process.env.DISCOVERY_STORE_PATH ?? "data/discovery.json";
const strategyPath = process.env.STRATEGY_STORE_PATH ?? "data/strategy.json";
const discovery = JSON.parse(await readFile(discoveryPath, "utf8"));
const history = await readStrategyHistory(strategyPath);
const plan = buildDailyPlan({ discovery, history, now: new Date() });
await writeStrategyHistory(strategyPath, plan);
console.log(JSON.stringify({
  plan: plan.latestPlan,
  strategyStorePath: strategyPath
}, null, 2));
