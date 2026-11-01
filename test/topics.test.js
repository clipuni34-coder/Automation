import test from "node:test";
import assert from "node:assert/strict";
import { buildTopicClusters, explainCandidateDecision } from "../src/discovery/topics.js";

test("groups related titles and separates unrelated titles", () => {
 const items = [
  {id:"a",title:"Scientists discover hidden ocean beneath Antarctica",creator:"A",publishedAt:"2026-10-31T12:00:00Z",score:60},
  {id:"b",title:"Hidden ocean discovered under Antarctic ice",creator:"B",publishedAt:"2026-10-31T12:00:00Z",score:60},
  {id:"c",title:"Football team wins championship final",creator:"C",publishedAt:"2026-10-31T12:00:00Z",score:50}
 ];
 const clusters=buildTopicClusters(items,new Date("2026-11-01T00:00:00Z"));
 assert.equal(clusters.length,2);
 assert.equal(clusters.find(x=>x.candidateCount===2).distinctCreatorCount,2);
});

test("holds weak candidates with reasons", () => {
 const result=explainCandidateDecision({score:20,confidence:"low"},null);
 assert.equal(result.decision,"hold");
 assert.ok(result.decisionReasons.length>=2);
});
