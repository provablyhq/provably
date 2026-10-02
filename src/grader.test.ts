import { test } from "node:test";
import assert from "node:assert/strict";
import { baselineScenarios, scenarios } from "./scenarios.js";
import {
  gradeScenario,
  gradeAll,
  falseFlagRate,
  aiLinePrecision,
  aiLineRecall,
  tokenPrecision,
  tokenRecall,
  type GradeTotals,
} from "./grader.js";

function scenarioByName(name: string) {
  const match = scenarios.find((scenario) => scenario.name === name);
  if (!match) throw new Error(`scenario not found: ${name}`);
  return match;
}

test("identity scenario scores perfectly", () => {
  const totals = gradeScenario(scenarioByName("identity: head equals base"));
  assert.equal(aiLinePrecision(totals), 1);
  assert.equal(aiLineRecall(totals), 1);
  assert.equal(falseFlagRate(totals), 0);
});

test("baseline scenarios never flag a pure-human line", () => {
  const { results } = gradeAll(baselineScenarios);
  for (const { scenario, totals } of results) {
    assert.equal(totals.pureHumanLinesFlagged, 0, `${scenario.name} produced a false flag`);
  }
});

test("confidence gate eliminates the realistic collision false flag", () => {
  const totals = gradeScenario(scenarioByName("collision: AI logging deleted, human adds similar logging"));
  assert.equal(totals.pureHumanLinesFlagged, 0);
});

test("verbatim reproduction remains a known content-matching limit", () => {
  const totals = gradeScenario(scenarioByName("verbatim-collision: human reproduces an AI line byte-for-byte"));
  assert.ok(totals.pureHumanLinesFlagged >= 1, "verbatim reproduction is expected to still leak until commit-level evidence exists");
});

test("metric helpers compute from counts correctly", () => {
  const totals: GradeTotals = {
    tokens: { truePositive: 8, falsePositive: 2, trueNegative: 40, falseNegative: 4 },
    pureHumanLines: 50,
    pureHumanLinesFlagged: 1,
    aiLineTruePositive: 9,
    aiLineFalsePositive: 1,
    aiLineFalseNegative: 3,
  };
  assert.equal(tokenPrecision(totals), 8 / 10);
  assert.equal(tokenRecall(totals), 8 / 12);
  assert.equal(aiLinePrecision(totals), 9 / 10);
  assert.equal(aiLineRecall(totals), 9 / 12);
  assert.equal(falseFlagRate(totals), 1 / 50);
});
