import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

const STREAMING_TAIL = Symbol("streaming markdown tail");
const referenceRule: Parameters<
  MarkdownIt["block"]["ruler"]["at"]
>[1] = require("markdown-it/lib/rules_block/reference");

/** Adds provisional inline formatting without changing the source or literal code blocks. */
export function enableStreamingMarkdown(parser: MarkdownIt): void {
  parser.block.ruler.at("reference", (state, startLine, endLine, silent) => {
    if (silent) return referenceRule(state, startLine, endLine, silent);
    const references = state.env.references && { ...state.env.references };
    const previousLine = state.line;
    const parsed = referenceRule(state, startLine, endLine, silent);
    // A reference destination can still grow until its final line terminates.
    if (parsed && state.line === state.lineMax && !state.src.endsWith("\n")) {
      state.env.references = references;
      state.line = previousLine;
      return false;
    }
    return parsed;
  });
  parser.core.ruler.at("inline", (state) => {
    const tail = state.tokens.findLast((token) => token.nesting !== -1);
    for (const token of state.tokens) {
      if (token.type === "inline") {
        const env = { ...state.env, [STREAMING_TAIL]: token === tail };
        token.children = [];
        state.md.inline.parse(token.content, state.md, env, token.children);
      }
    }
  });
  parser.inline.ruler.before("backticks", "streaming_code", completeCode);
  parser.inline.ruler.before("strikethrough", "streaming_marker", hideOpeningMarker);
  parser.inline.ruler.after("image", "streaming_link", completeLink);
  parser.inline.ruler2.after("balance_pairs", "streaming_emphasis", completeEmphasis);
  parser.core.ruler.after("linkify", "streaming_link_text", (state) => {
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type === "streaming_link_text") token.type = "text";
      }
    }

    // An automatic link at the growing tail has no closing delimiter yet.
    // Keep its text visible until whitespace, more text, or turn completion.
    if (/\s$/.test(state.src)) return;
    const tail = state.tokens.findLast((token) => token.nesting !== -1);
    const children = tail?.type === "inline" ? tail.children : null;
    if (!children) return;
    const opening = children.findLastIndex(
      (token) => token.type === "link_open" && token.markup === "linkify",
    );
    if (opening < 0 || children[opening + 2]?.type !== "link_close") return;
    const suffix = children.slice(opening + 3);
    if (
      suffix.every(
        (token) =>
          token.nesting === -1 || (token.type === "text" && /^[\p{P}\p{S}]*$/u.test(token.content)),
      )
    ) {
      children.splice(opening + 2, 1);
      children.splice(opening, 1);
    }
  });
}

function isStreamingTail(state: StateInline): boolean {
  return state.env[STREAMING_TAIL] === true && state.posMax === state.src.length;
}

function hideOpeningMarker(state: StateInline, silent: boolean): boolean {
  if (silent || !isStreamingTail(state)) return false;
  if (!/^(?:\*{1,3}|_{1,3}|~{1,2})$/.test(state.src.slice(state.pos))) return false;
  if (state.scanDelims(state.pos, state.src[state.pos] !== "_").can_close) return false;
  state.pos = state.posMax;
  return true;
}

function completeCode(state: StateInline, silent: boolean): boolean {
  if (silent || !isStreamingTail(state) || state.src[state.pos] !== "`") return false;
  const runs = /`+/g;
  runs.lastIndex = state.pos;
  const opening = runs.exec(state.src)!;
  let closing: RegExpExecArray | null;
  while ((closing = runs.exec(state.src))) {
    if (closing[0].length === opening[0].length) return false;
  }
  let content = state.src.slice(state.pos + opening[0].length);
  // A shorter trailing run may be the first characters of the closing marker.
  const partialClosing = content.match(/`+$/);
  if (partialClosing && partialClosing[0].length < opening[0].length) {
    content = content.slice(0, -partialClosing[0].length);
  }
  if (content) {
    const token = state.push("code_inline", "code", 0);
    token.markup = opening[0];
    token.info = "streaming";
    token.content = content.replace(/\n/g, " ").replace(/^ (.+) $/, "$1");
  }
  state.pos = state.posMax;
  return true;
}

function completeLink(state: StateInline, silent: boolean): boolean {
  if (silent || !isStreamingTail(state)) return false;
  const image = state.src[state.pos] === "!";
  const start = state.pos + (image ? 1 : 0);
  if (state.src[start] !== "[") return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, start, false);
  if (labelEnd !== -1 && labelEnd + 1 < state.posMax) {
    if (state.src[labelEnd + 1] !== "(" || hasClosedDestination(state.src, labelEnd + 1)) {
      return false;
    }
  }
  const end = state.posMax;
  if (!image) {
    if (state.pending) state.pushPending();
    const firstLabelToken = state.tokens.length;
    state.pos = start + 1;
    state.posMax = labelEnd === -1 ? end : labelEnd;
    state.level++;
    state.md.inline.tokenize(state);
    state.level--;
    // Keep URL-shaped labels out of the automatic linkifier until the real
    // destination arrives. Restore ordinary text before tokens reach the view.
    for (let index = firstLabelToken; index < state.tokens.length; index++) {
      if (state.tokens[index].type === "text") state.tokens[index].type = "streaming_link_text";
    }
  }
  state.pos = state.posMax = end;
  return true;
}

function hasClosedDestination(source: string, start: number): boolean {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      index++;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === "<") {
      quote = ">";
    } else if ((char === '"' || char === "'") && /\s/.test(source[index - 1])) {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      return true;
    }
  }
  return false;
}

function completeEmphasis(state: StateInline): boolean {
  if (!isStreamingTail(state)) return false;
  const open = [];
  let closedThrough = -1;
  // Reuse markdown-it's escape, word-boundary, nesting and delimiter matching
  // decisions. Only unmatched openers outside already-closed spans reach EOF.
  for (const [index, delimiter] of state.delimiters.entries()) {
    if (delimiter.end !== -1) {
      closedThrough = Math.max(closedThrough, delimiter.end);
    } else if (index > closedThrough && delimiter.open) {
      open.push(delimiter);
    }
  }
  for (const delimiter of open.toReversed()) {
    if (delimiter.marker === 126 && /(?<![\\~])~$/.test(state.src)) {
      const last = state.tokens.at(-1);
      if (last?.type === "text" && last.content.endsWith("~")) {
        last.content = last.content.slice(0, -1);
      }
    }
    const closing = state.push("text", "", 0);
    closing.content = String.fromCharCode(delimiter.marker).repeat(
      delimiter.marker === 126 ? 2 : 1,
    );
    delimiter.end = state.delimiters.length;
    state.delimiters.push({
      ...delimiter,
      token: state.tokens.length - 1,
      end: -1,
      open: false,
      close: true,
    });
  }
  return true;
}
