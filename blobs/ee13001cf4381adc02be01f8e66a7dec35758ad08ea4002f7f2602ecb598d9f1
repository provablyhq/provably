import { SimulatedRepo, deltaOnlyLedger } from "./history-sim.js";
import { resolveFileProvenanceFromHistory } from "./resolve.js";
import { emptyTotals, accumulateLineCounts, type GradeTotals } from "./grader.js";
import type { LedgerEvent } from "./ledger.js";
import type { ChainMethod } from "./chain.js";
import type { HistoryScenario } from "./history-scenarios.js";

export interface HistoryScenarioResult {
  readonly name: string;
  readonly ambiguity: string | null;
  readonly deltaOnly: GradeTotals;
  readonly chained: GradeTotals;
  readonly reanchored: GradeTotals;
  readonly chainMethods: readonly ChainMethod[];
}

export function gradeHistoryScenario(scenario: HistoryScenario): HistoryScenarioResult {
  const repo = new SimulatedRepo();
  try {
    scenario.run(repo);
    repo.assertModelMatchesDisk();
    return {
      name: scenario.name,
      ambiguity: scenario.ambiguity ?? null,
      deltaOnly: gradeHead(repo, deltaOnlyLedger(repo.events), false),
      chained: gradeHead(repo, repo.events, false),
      reanchored: gradeHead(repo, repo.events, true),
      chainMethods: [...repo.chainMethods],
    };
  } finally {
    repo.dispose();
  }
}

function gradeHead(repo: SimulatedRepo, events: readonly LedgerEvent[], reanchor: boolean): GradeTotals {
  const totals = emptyTotals();
  const options = reanchor ? { snapshotFor: (sha: string) => repo.snapshotFor(sha) } : {};
  for (const file of repo.trackedFiles()) {
    const predicted = resolveFileProvenanceFromHistory(repo.dir, "HEAD", file, events, options).lines;
    accumulateLineCounts(totals, predicted, repo.truthLines(file));
  }
  return totals;
}

export function gradeAllHistory(scenarios: readonly HistoryScenario[]): {
  results: HistoryScenarioResult[];
  deltaOnly: GradeTotals;
  chained: GradeTotals;
  reanchored: GradeTotals;
} {
  const results = scenarios.map(gradeHistoryScenario);
  const deltaOnly = emptyTotals();
  const chained = emptyTotals();
  const reanchored = emptyTotals();
  for (const result of results) {
    mergeLineCounts(deltaOnly, result.deltaOnly);
    mergeLineCounts(chained, result.chained);
    mergeLineCounts(reanchored, result.reanchored);
  }
  return { results, deltaOnly, chained, reanchored };
}

function mergeLineCounts(target: GradeTotals, source: GradeTotals): void {
  target.pureHumanLines += source.pureHumanLines;
  target.pureHumanLinesFlagged += source.pureHumanLinesFlagged;
  target.aiLineTruePositive += source.aiLineTruePositive;
  target.aiLineFalsePositive += source.aiLineFalsePositive;
  target.aiLineFalseNegative += source.aiLineFalseNegative;
}
