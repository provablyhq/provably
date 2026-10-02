import type { CheckRunPayload } from "./pr-check.js";

function escapeData(text: string): string {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function workflowAnnotationCommands(payload: CheckRunPayload): string[] {
  return payload.output.annotations.map((annotation) => {
    const properties = [
      `file=${escapeProperty(annotation.path)}`,
      `line=${annotation.start_line}`,
      `endLine=${annotation.end_line}`,
      `title=${escapeProperty(annotation.title)}`,
    ].join(",");
    return `::${annotation.annotation_level} ${properties}::${escapeData(annotation.message)}`;
  });
}

export function stepSummaryMarkdown(payload: CheckRunPayload): string {
  const lines = [`## ${payload.output.title}`, "", payload.output.summary, ""];
  if (payload.output.annotations.length > 0) {
    lines.push("### Findings, highest risk first", "");
    lines.push("| Location | Risk | Details |");
    lines.push("|---|---|---|");
    for (const annotation of payload.output.annotations) {
      const span = annotation.start_line === annotation.end_line ? `${annotation.start_line}` : `${annotation.start_line}-${annotation.end_line}`;
      const risk = annotation.annotation_level === "warning" ? "high" : annotation.title.includes("possibly sensitive") ? "elevated" : "standard";
      lines.push(`| \`${annotation.path}:${span}\` | ${risk} | ${annotation.message.replace(/\n/g, "<br>").replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
