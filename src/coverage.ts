export type LineHits = ReadonlyMap<number, number>;
export type CoverageReport = ReadonlyMap<string, LineHits>;
export type CoverageFormat = "lcov" | "cobertura" | "coveragepy";

export function detectCoverageFormat(text: string): CoverageFormat {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return "coveragepy";
  if (trimmed.startsWith("<") || /<coverage\b/.test(trimmed.slice(0, 2000))) return "cobertura";
  if (/^SF:/m.test(text)) return "lcov";
  throw new Error("unrecognized coverage report: expected lcov, cobertura XML or coverage.py JSON");
}

export function parseCoverage(text: string): CoverageReport {
  const format = detectCoverageFormat(text);
  if (format === "lcov") return parseLcov(text);
  if (format === "cobertura") return parseCobertura(text);
  return parseCoveragePyJson(text);
}

export function mergeCoverageReports(reports: readonly CoverageReport[]): CoverageReport {
  const merged = new Map<string, Map<number, number>>();
  for (const report of reports) {
    for (const [file, lineHits] of report) {
      for (const [lineNumber, hits] of lineHits) recordHits(merged, file, lineNumber, hits);
    }
  }
  return merged;
}

export function parseLcov(text: string): CoverageReport {
  const report = new Map<string, Map<number, number>>();
  let currentFile: string | null = null;
  let functionLinesByName = new Map<string, number>();
  let functionCallsByName = new Map<string, number>();
  const finishRecord = () => {
    if (currentFile === null) return;
    for (const [name, calls] of functionCallsByName) {
      const declarationLine = functionLinesByName.get(name);
      if (declarationLine !== undefined && calls > 0) recordHits(report, currentFile, declarationLine, calls);
    }
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      finishRecord();
      currentFile = normalizeSlashes(line.slice(3));
      functionLinesByName = new Map();
      functionCallsByName = new Map();
      if (!report.has(currentFile)) report.set(currentFile, new Map());
    } else if (line === "end_of_record") {
      finishRecord();
      currentFile = null;
    } else if (currentFile === null) {
      continue;
    } else if (line.startsWith("DA:")) {
      const [lineNumberText, hitsText] = line.slice(3).split(",");
      const lineNumber = Number(lineNumberText);
      const hits = Number(hitsText);
      if (Number.isInteger(lineNumber) && Number.isFinite(hits)) recordHits(report, currentFile, lineNumber, hits);
    } else if (line.startsWith("FN:")) {
      const declaration = /^FN:(\d+)(?:,\d+)?,(.+)$/.exec(line);
      if (declaration !== null) functionLinesByName.set(declaration[2]!, Number(declaration[1]));
    } else if (line.startsWith("FNDA:")) {
      const calls = /^FNDA:(\d+),(.+)$/.exec(line);
      if (calls !== null) functionCallsByName.set(calls[2]!, Math.max(functionCallsByName.get(calls[2]!) ?? 0, Number(calls[1])));
    }
  }
  finishRecord();
  return report;
}

export function parseCobertura(text: string): CoverageReport {
  const report = new Map<string, Map<number, number>>();
  const sources = [...text.matchAll(/<source>([\s\S]*?)<\/source>/g)].map((match) =>
    normalizeSlashes(decodeXmlEntities(match[1]!.trim())).replace(/\/+$/, ""),
  );
  const sourcePrefix = sources.length === 1 ? sources[0]! : "";
  let currentFile: string | null = null;
  for (const match of text.matchAll(/<(class|line)\b([^>]*)>|<\/class>/g)) {
    if (match[0] === "</class>") {
      currentFile = null;
      continue;
    }
    const attributes = parseXmlAttributes(match[2]!);
    if (match[1] === "class") {
      const filename = attributes.get("filename");
      if (filename === undefined) continue;
      const normalized = normalizeSlashes(filename);
      currentFile = sourcePrefix === "" || normalized.startsWith("/") ? normalized : `${sourcePrefix}/${normalized}`;
      if (!report.has(currentFile)) report.set(currentFile, new Map());
    } else if (currentFile !== null) {
      const lineNumber = Number(attributes.get("number"));
      const hits = Number(attributes.get("hits"));
      if (Number.isInteger(lineNumber) && Number.isFinite(hits)) recordHits(report, currentFile, lineNumber, hits);
    }
  }
  return report;
}

export function parseCoveragePyJson(text: string): CoverageReport {
  const parsed = JSON.parse(text) as { files?: Record<string, { executed_lines?: number[]; missing_lines?: number[] }> };
  if (parsed.files === undefined || typeof parsed.files !== "object") {
    throw new Error("coverage.py JSON has no 'files' object");
  }
  const report = new Map<string, Map<number, number>>();
  for (const [file, data] of Object.entries(parsed.files)) {
    const normalized = normalizeSlashes(file);
    report.set(normalized, new Map());
    for (const lineNumber of data.missing_lines ?? []) recordHits(report, normalized, lineNumber, 0);
    for (const lineNumber of data.executed_lines ?? []) recordHits(report, normalized, lineNumber, 1);
  }
  return report;
}

export function coverageForFile(report: CoverageReport, repoRelativeFile: string): LineHits | null {
  return report.get(normalizeSlashes(repoRelativeFile)) ?? null;
}

export function alignCoverageToRepo(report: CoverageReport, trackedFiles: readonly string[]): CoverageReport {
  const tracked = new Set(trackedFiles);
  const prefixVotes = new Map<string, number>();
  for (const key of report.keys()) {
    if (tracked.has(key)) continue;
    const prefix = checkoutPrefixForKey(key, tracked);
    if (prefix !== null) prefixVotes.set(prefix, (prefixVotes.get(prefix) ?? 0) + 1);
  }
  const checkoutPrefix = [...prefixVotes].sort((left, right) => right[1] - left[1] || left[0].length - right[0].length)[0]?.[0] ?? null;

  const aligned = new Map<string, Map<number, number>>();
  for (const [key, lineHits] of report) {
    let repoFile: string | null = null;
    if (tracked.has(key)) repoFile = key;
    else if (checkoutPrefix !== null && key.startsWith(checkoutPrefix) && tracked.has(key.slice(checkoutPrefix.length))) {
      repoFile = key.slice(checkoutPrefix.length);
    }
    if (repoFile === null) continue;
    for (const [lineNumber, hits] of lineHits) recordHits(aligned, repoFile, lineNumber, hits);
  }
  return aligned;
}

function checkoutPrefixForKey(key: string, tracked: ReadonlySet<string>): string | null {
  const segments = key.split("/");
  for (let start = 1; start < segments.length; start++) {
    const candidate = segments.slice(start).join("/");
    if (tracked.has(candidate)) return `${segments.slice(0, start).join("/")}/`;
  }
  return null;
}

function recordHits(report: Map<string, Map<number, number>>, file: string, lineNumber: number, hits: number): void {
  let lineHits = report.get(file);
  if (lineHits === undefined) {
    lineHits = new Map();
    report.set(file, lineHits);
  }
  lineHits.set(lineNumber, Math.max(lineHits.get(lineNumber) ?? 0, hits));
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseXmlAttributes(attributeText: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of attributeText.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    attributes.set(match[1]!, decodeXmlEntities(match[2]!));
  }
  return attributes;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
