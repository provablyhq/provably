interface CodeToken {
  readonly text: string;
  readonly line: number;
  readonly kind: "word" | "punct" | "literal";
}

const OPENING = new Set(["{", "(", "["]);
const CLOSING = new Set(["}", ")", "]"]);
const CONTINUATION_AT_LINE_END = new Set(["|", "&", "=", ",", "<", ":", "?", ".", "(", "[", "{"]);
const CONTINUATION_AT_LINE_START = new Set(["|", "&", ".", "?", ":", "=", ">", ")", "]", "}", ","]);
const REGEX_ALLOWED_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

export function isTypeScriptFile(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/i.test(path);
}

export function typeOnlyLines(content: string): Set<number> {
  const tokens = lexCode(content);
  const lines = new Set<number>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const atStatementStart =
      previous === undefined || (previous.kind === "punct" && [";", "{", "}"].includes(previous.text)) || previous.line < token.line;
    if (atStatementStart && token.kind === "word") {
      const end = typeDeclarationEnd(tokens, index);
      if (end !== -1) {
        for (let line = token.line; line <= tokens[end]!.line; line++) lines.add(line);
        index = end + 1;
        continue;
      }
    }
    index++;
  }
  return lines;
}

function typeDeclarationEnd(tokens: readonly CodeToken[], start: number): number {
  const textAt = (offset: number) => tokens[start + offset]?.text;
  const kindAt = (offset: number) => tokens[start + offset]?.kind;

  if (textAt(0) === "import" && textAt(1) === "type" && (kindAt(2) === "word" || textAt(2) === "{" || textAt(2) === "*")) {
    return statementEnd(tokens, start, "statement");
  }
  let offset = 0;
  if (textAt(offset) === "export") {
    if (textAt(1) === "type" && (textAt(2) === "{" || textAt(2) === "*")) return statementEnd(tokens, start, "statement");
    offset++;
    if (textAt(offset) === "default") offset++;
  }
  const keyword = textAt(offset);
  if (keyword === "declare" && kindAt(offset + 1) === "word") return statementEnd(tokens, start, "declare");
  if (keyword === "interface" && kindAt(offset + 1) === "word") return statementEnd(tokens, start, "block");
  if (keyword === "type" && kindAt(offset + 1) === "word" && (textAt(offset + 2) === "=" || textAt(offset + 2) === "<")) {
    return statementEnd(tokens, start, "statement");
  }
  return -1;
}

type StatementShape = "statement" | "declare" | "block";

function statementEnd(tokens: readonly CodeToken[], start: number, shape: StatementShape): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.kind === "punct" && OPENING.has(token.text)) depth++;
    if (token.kind === "punct" && CLOSING.has(token.text)) {
      depth--;
      if (depth < 0) return index - 1;
      if (depth === 0 && token.text === "}" && shape !== "statement") return index;
    }
    if (depth !== 0 || shape === "block") continue;
    if (token.text === ";") return index;
    const next = tokens[index + 1];
    if (next === undefined) return index;
    const lineBreak = next.line > token.line;
    const continues = CONTINUATION_AT_LINE_END.has(token.text) || CONTINUATION_AT_LINE_START.has(next.text);
    if (lineBreak && !continues) return index;
  }
  return tokens.length - 1;
}

function lexCode(content: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let line = 1;
  let index = 0;
  const templateBraceDepths: number[] = [];
  let braceDepth = 0;

  const push = (text: string, kind: CodeToken["kind"], tokenLine: number) => tokens.push({ text, line: tokenLine, kind });
  const advanceOver = (end: number) => {
    for (let position = index; position < end; position++) if (content.charCodeAt(position) === 10) line++;
    index = end;
  };

  const scanTemplate = () => {
    const startLine = line;
    let position = index;
    while (position < content.length) {
      const character = content[position]!;
      if (character === "\\") {
        position += 2;
        continue;
      }
      if (character === "`") {
        advanceOver(position + 1);
        push("`", "literal", startLine);
        return;
      }
      if (character === "$" && content[position + 1] === "{") {
        advanceOver(position + 2);
        push("`", "literal", startLine);
        templateBraceDepths.push(braceDepth);
        braceDepth++;
        return;
      }
      position++;
    }
    advanceOver(content.length);
    push("`", "literal", startLine);
  };

  while (index < content.length) {
    const character = content[index]!;
    if (character === "\n") {
      line++;
      index++;
      continue;
    }
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      const newline = content.indexOf("\n", index);
      index = newline === -1 ? content.length : newline;
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const close = content.indexOf("*/", index + 2);
      advanceOver(close === -1 ? content.length : close + 2);
      continue;
    }
    if (character === '"' || character === "'") {
      const startLine = line;
      let position = index + 1;
      while (position < content.length && content[position] !== character && content[position] !== "\n") {
        position += content[position] === "\\" ? 2 : 1;
      }
      advanceOver(Math.min(position + 1, content.length));
      push(character, "literal", startLine);
      continue;
    }
    if (character === "`") {
      index++;
      scanTemplate();
      continue;
    }
    if (character === "/" && regexAllowed(tokens[tokens.length - 1])) {
      const startLine = line;
      let position = index + 1;
      let inClass = false;
      while (position < content.length && content[position] !== "\n") {
        const regexCharacter = content[position]!;
        if (regexCharacter === "\\") {
          position += 2;
          continue;
        }
        if (regexCharacter === "[") inClass = true;
        else if (regexCharacter === "]") inClass = false;
        else if (regexCharacter === "/" && !inClass) break;
        position++;
      }
      position++;
      while (position < content.length && /[a-z]/i.test(content[position]!)) position++;
      advanceOver(Math.min(position, content.length));
      push("/regex/", "literal", startLine);
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*|^\d[\w.]*/.exec(content.slice(index, index + 256));
    if (word !== null) {
      push(word[0], /^\d/.test(word[0]) ? "literal" : "word", line);
      index += word[0].length;
      continue;
    }
    if (character === "{") braceDepth++;
    if (character === "}") {
      braceDepth--;
      if (templateBraceDepths.length > 0 && templateBraceDepths[templateBraceDepths.length - 1] === braceDepth) {
        templateBraceDepths.pop();
        index++;
        scanTemplate();
        continue;
      }
    }
    push(character, "punct", line);
    index++;
  }
  return tokens;
}

function regexAllowed(previous: CodeToken | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === "word") return REGEX_ALLOWED_AFTER_WORD.has(previous.text);
  if (previous.kind === "literal") return false;
  return !CLOSING.has(previous.text);
}
