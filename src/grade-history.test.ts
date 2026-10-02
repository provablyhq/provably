import { test } from "node:test";
import assert from "node:assert/strict";
import { historyScenarios } from "./history-scenarios.js";
import { gradeAllHistory } from "./grade-history.js";
import { aiLinePrecision, aiLineRecall, falseFlagRate } from "./grader.js";

test("git topology stress test: chaining and re-anchoring raise recall without false flags", () => {
  const { results, deltaOnly, chained, reanchored } = gradeAllHistory(historyScenarios);
  assert.equal(falseFlagRate(chained), 0);
  assert.equal(aiLinePrecision(chained), 1);
  assert.ok(falseFlagRate(reanchored) <= 0.01);
  assert.ok(aiLinePrecision(reanchored) >= 0.9);
  for (const result of results) {
    assert.equal(result.chained.pureHumanLinesFlagged, 0, result.name);
    assert.ok(aiLineRecall(result.chained) >= aiLineRecall(result.deltaOnly), result.name);
    assert.ok(aiLineRecall(result.reanchored) >= aiLineRecall(result.chained), result.name);
    if (result.ambiguity === null) assert.equal(result.reanchored.pureHumanLinesFlagged, 0, result.name);
  }
  assert.ok(aiLineRecall(chained) > aiLineRecall(deltaOnly));
  assert.ok(aiLineRecall(reanchored) > aiLineRecall(chained));
});
