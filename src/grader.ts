import { tokenize } from "./tokenize.js";
import { labelsFromRanges } from "./ledger.js";
import { propagateLabels } from "./propagate.js";
import { rollupByLine, type LineProvenance } from "./lines.js";
import type { Scenario, TransformationCategory } from "./scenarios.js";

export interface Counts {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

export interface GradeTotals {
  readonly tokens: Counts;
  pureHumanLines: number;
  pureHumanLinesFlagged: number;
  aiLineTruePositive: number;
  aiLineFalsePositive: number;
  aiLineFalseNegative: number;
}

export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly totals: GradeTotals;
}

const AI_LINE_THRESHOLD = 0.5;

export function emptyTotals(): GradeTotals {
  return {
    tokens: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 },
    pureHumanLines: 0,
    pureHumanLinesFlagged: 0,
    aiLineTruePositive: 0,
    aiLineFalsePositive: 0,
    aiLineFalseNegative: 0,
  };
}

function addCounts(target: GradeTotals, source: GradeTotals): void {
  target.tokens.truePositive += source.tokens.truePositive;
  target.tokens.falsePositive += source.tokens.falsePositive;
  target.tokens.trueNegative += source.tokens.trueNegative;
  target.tokens.falseNegative += source.tokens.falseNegative;
  target.pureHumanLines += source.pureHumanLines;
  target.pureHumanLinesFlagged += source.pureHumanLinesFlagged;
  target.aiLineTruePositive += source.aiLineTruePositive;
  target.aiLineFalsePositive += source.aiLineFalsePositive;
  target.aiLineFalseNegative += source.aiLineFalseNegative;
}

export function gradeScenario(scenario: Scenario): GradeTotals {
  const totals = emptyTotals();

  const baseLabels = labelsFromRanges(scenario.base.content, scenario.base.aiRanges);
  const propagation = propagateLabels(scenario.base.content, baseLabels, scenario.head.content);
  const predictedLabels = propagation.labels;

  const trueLabels = labelsFromRanges(scenario.head.content, scenario.head.aiRanges);

  for (let tokenIndex = 0; tokenIndex < trueLabels.length; tokenIndex++) {
    const predicted = predictedLabels[tokenIndex]!;
    const actual = trueLabels[tokenIndex]!;
    if (predicted && actual) totals.tokens.truePositive++;
    else if (predicted && !actual) totals.tokens.falsePositive++;
    else if (!predicted && actual) totals.tokens.falseNegative++;
    else totals.tokens.trueNegative++;
  }

  const headTokens = tokenize(scenario.head.content);
  const trueTokens = headTokens.map((token, tokenIndex) => ({ ...token, ai: trueLabels[tokenIndex]! }));
  const predictedLines = rollupByLine(scenario.head.content, propagation.tokens);
  const trueLines = rollupByLine(scenario.head.content, trueTokens);

  accumulateLineCounts(totals, predictedLines, trueLines);
  return totals;
}

export function accumulateLineCounts(
  totals: GradeTotals,
  predictedLines: readonly LineProvenance[],
  trueLines: readonly LineProvenance[],
): void {
  for (let lineIndex = 0; lineIndex < trueLines.length; lineIndex++) {
    const trueLine = trueLines[lineIndex]!;
    const predictedLine = predictedLines[lineIndex];
    if (trueLine.totalTokenCount === 0) continue;

    const predictedRatio = predictedLine?.aiRatio ?? 0;
    if (trueLine.aiRatio === 0) {
      totals.pureHumanLines++;
      if (predictedRatio > 0) totals.pureHumanLinesFlagged++;
    }

    const trueIsAi = trueLine.aiRatio >= AI_LINE_THRESHOLD;
    const predictedIsAi = predictedRatio >= AI_LINE_THRESHOLD;
    if (trueIsAi && predictedIsAi) totals.aiLineTruePositive++;
    else if (!trueIsAi && predictedIsAi) totals.aiLineFalsePositive++;
    else if (trueIsAi && !predictedIsAi) totals.aiLineFalseNegative++;
  }
}

export function gradeAll(scenarios: readonly Scenario[]): {
  results: ScenarioResult[];
  overall: GradeTotals;
  byCategory: Map<TransformationCategory, GradeTotals>;
} {
  const results: ScenarioResult[] = [];
  const overall = emptyTotals();
  const byCategory = new Map<TransformationCategory, GradeTotals>();

  for (const scenario of scenarios) {
    const totals = gradeScenario(scenario);
    results.push({ scenario, totals });
    addCounts(overall, totals);
    const categoryTotals = byCategory.get(scenario.category) ?? emptyTotals();
    addCounts(categoryTotals, totals);
    byCategory.set(scenario.category, categoryTotals);
  }

  return { results, overall, byCategory };
}

export function tokenPrecision(totals: GradeTotals): number {
  const flagged = totals.tokens.truePositive + totals.tokens.falsePositive;
  return flagged === 0 ? 1 : totals.tokens.truePositive / flagged;
}

export function tokenRecall(totals: GradeTotals): number {
  const actual = totals.tokens.truePositive + totals.tokens.falseNegative;
  return actual === 0 ? 1 : totals.tokens.truePositive / actual;
}

export function aiLinePrecision(totals: GradeTotals): number {
  const flagged = totals.aiLineTruePositive + totals.aiLineFalsePositive;
  return flagged === 0 ? 1 : totals.aiLineTruePositive / flagged;
}

export function aiLineRecall(totals: GradeTotals): number {
  const actual = totals.aiLineTruePositive + totals.aiLineFalseNegative;
  return actual === 0 ? 1 : totals.aiLineTruePositive / actual;
}

export function falseFlagRate(totals: GradeTotals): number {
  return totals.pureHumanLines === 0 ? 0 : totals.pureHumanLinesFlagged / totals.pureHumanLines;
}
