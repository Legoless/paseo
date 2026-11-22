import type { TerminalCell, TerminalState } from "./messages.js";

interface TerminalStyle {
  fg: number | undefined;
  bg: number | undefined;
  fgMode: number | undefined;
  bgMode: number | undefined;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

const DEFAULT_STYLE: TerminalStyle = {
  fg: undefined,
  bg: undefined,
  fgMode: undefined,
  bgMode: undefined,
  bold: false,
  italic: false,
  underline: false,
  dim: false,
  inverse: false,
  strikethrough: false,
};

// Private OSC carrying the daemon's snapshot grid dimensions ahead of Restore ANSI
// payloads so clients replay at the snapshot's exact width before refitting to the pane.
// Older clients ignore unknown OSC codes silently; older daemons omit the prefix.
const TERMINAL_RESTORE_SIZE_OSC_CODE = 7502;
const TERMINAL_RESTORE_SIZE_OSC_PREFIX = [0x1b, 0x5d, 0x37, 0x35, 0x30, 0x32, 0x3b] as const;
const MAX_TERMINAL_RESTORE_SIZE_HEADER_BYTES = 32;
const MAX_TERMINAL_RESTORE_DIMENSION = 10_000;

export interface ParsedTerminalRestorePayload {
  data: Uint8Array;
  cols?: number;
  rows?: number;
}

export function encodeTerminalRestoreAnsi(state: TerminalState): string {
  return `\u001b]${TERMINAL_RESTORE_SIZE_OSC_CODE};${state.cols};${state.rows}\u0007${renderTerminalSnapshotToAnsi(state)}`;
}

export function parseTerminalRestoreSizeHeader(data: Uint8Array): ParsedTerminalRestorePayload {
  const prefixLength = TERMINAL_RESTORE_SIZE_OSC_PREFIX.length;
  if (data.length <= prefixLength + 3) {
    return { data };
  }
  for (let index = 0; index < prefixLength; index += 1) {
    if (data[index] !== TERMINAL_RESTORE_SIZE_OSC_PREFIX[index]) {
      return { data };
    }
  }

  const scanLimit = Math.min(data.length, MAX_TERMINAL_RESTORE_SIZE_HEADER_BYTES);
  let separatorIndex = -1;
  let terminatorIndex = -1;
  for (let index = prefixLength; index < scanLimit; index += 1) {
    const byte = data[index];
    if (byte === 0x3b) {
      if (separatorIndex !== -1) {
        return { data };
      }
      separatorIndex = index;
      continue;
    }
    if (byte === 0x07) {
      terminatorIndex = index;
      break;
    }
    if (byte < 0x30 || byte > 0x39) {
      return { data };
    }
  }

  if (separatorIndex === -1 || terminatorIndex === -1) {
    return { data };
  }

  const cols = parsePositiveAsciiInt(data, prefixLength, separatorIndex);
  const rows = parsePositiveAsciiInt(data, separatorIndex + 1, terminatorIndex);
  if (cols === null || rows === null) {
    return { data };
  }

  return {
    data: data.subarray(terminatorIndex + 1),
    cols,
    rows,
  };
}

function parsePositiveAsciiInt(data: Uint8Array, start: number, end: number): number | null {
  if (end <= start) {
    return null;
  }
  let value = 0;
  for (let index = start; index < end; index += 1) {
    const digit = data[index] - 0x30;
    if (digit < 0 || digit > 9) {
      return null;
    }
    value = value * 10 + digit;
    if (value > MAX_TERMINAL_RESTORE_DIMENSION) {
      return null;
    }
  }
  return value > 0 ? value : null;
}

export function renderTerminalSnapshotToAnsi(state: TerminalState): string {
  const rows = [...state.scrollback, ...state.grid];
  const wrapFlags = [...(state.scrollbackWrapped ?? []), ...(state.gridWrapped ?? [])];
  // Soft-wrapped lines can only be re-wrapped on resize when we know which rows
  // were continuations. With that per-row flag we replay each logical line as one
  // unbroken run (autowrap on) so xterm marks the continuations wrapped and reflows
  // them. Without it (old daemon) we keep the verbatim per-row replay: autowrap off
  // plus a hard newline per row.
  const hasWrapInfo = wrapFlags.length === rows.length;
  const lines: string[] = hasWrapInfo ? [] : ["\u001b[?7l"];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const continuesToNextRow = hasWrapInfo && wrapFlags[rowIndex] === true;
    // A continuation row must fill the full width so the next row first cell
    // triggers xterm auto-wrap, which is what marks the row wrapped/reflowable.
    lines.push(renderTerminalRow(row, continuesToNextRow ? state.cols : undefined));
    if (rowIndex < rows.length - 1 && !continuesToNextRow) {
      lines.push("\r\n");
    }
  }

  lines.push("\u001b[0m");
  const cursorPresentationAnsi = renderCursorPresentationToAnsi(state.cursor);
  if (cursorPresentationAnsi) {
    lines.push(cursorPresentationAnsi);
  }
  lines.push(`\u001b[${state.cursor.row + 1};${state.cursor.col + 1}H`);
  lines.push(state.cursor.hidden ? "\u001b[?25l" : "\u001b[?25h");
  if (!hasWrapInfo) {
    lines.push("\u001b[?7h");
  }
  return lines.join("");
}

function renderCursorPresentationToAnsi(cursor: TerminalState["cursor"]): string | null {
  if (!cursor.style) {
    return null;
  }

  const cursorStyleCode = (() => {
    if (cursor.style === "block") {
      return cursor.blink === false ? 2 : 1;
    }
    if (cursor.style === "underline") {
      return cursor.blink === false ? 4 : 3;
    }
    return cursor.blink === false ? 6 : 5;
  })();

  return `\u001b[${cursorStyleCode} q`;
}

function renderTerminalRow(row: TerminalCell[], padToCols?: number): string {
  const output: string[] = [];
  const contentLength = getTerminalRowLength(row);
  const length = padToCols !== undefined ? Math.max(contentLength, padToCols) : contentLength;
  let previousStyle = DEFAULT_STYLE;

  for (let index = 0; index < length; index += 1) {
    const cell = row[index] ?? { char: " " };
    // An empty char marks a wide-char continuation cell. The glyph in the
    // previous cell already advances the cursor two columns, so emitting
    // anything here would shift the rest of the row one column right.
    if (cell.char === "") {
      continue;
    }
    const nextStyle = getTerminalStyle(cell);
    if (!terminalStylesEqual(previousStyle, nextStyle)) {
      output.push(styleToAnsi(nextStyle));
      previousStyle = nextStyle;
    }
    output.push(cell.char || " ");
  }

  if (!terminalStylesEqual(previousStyle, DEFAULT_STYLE)) {
    output.push("\u001b[0m");
  }

  return output.join("");
}

function getTerminalRowLength(row: TerminalCell[]): number {
  for (let index = row.length - 1; index >= 0; index -= 1) {
    const cell = row[index];
    if (!cell) {
      continue;
    }
    if (cell.char !== " ") {
      return index + 1;
    }
    if (
      cell.fg !== undefined ||
      cell.bg !== undefined ||
      cell.fgMode !== undefined ||
      cell.bgMode !== undefined ||
      cell.bold ||
      cell.italic ||
      cell.underline ||
      cell.dim ||
      cell.inverse ||
      cell.strikethrough
    ) {
      return index + 1;
    }
  }
  return 0;
}

function getTerminalStyle(cell: TerminalCell): TerminalStyle {
  return {
    fg: cell.fg,
    bg: cell.bg,
    fgMode: cell.fgMode,
    bgMode: cell.bgMode,
    bold: Boolean(cell.bold),
    italic: Boolean(cell.italic),
    underline: Boolean(cell.underline),
    dim: Boolean(cell.dim),
    inverse: Boolean(cell.inverse),
    strikethrough: Boolean(cell.strikethrough),
  };
}

function terminalStylesEqual(left: TerminalStyle, right: TerminalStyle): boolean {
  return (
    left.fg === right.fg &&
    left.bg === right.bg &&
    left.fgMode === right.fgMode &&
    left.bgMode === right.bgMode &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.dim === right.dim &&
    left.inverse === right.inverse &&
    left.strikethrough === right.strikethrough
  );
}

function styleToAnsi(style: TerminalStyle): string {
  const codes = ["0"];

  if (style.bold) {
    codes.push("1");
  }
  if (style.dim) {
    codes.push("2");
  }
  if (style.italic) {
    codes.push("3");
  }
  if (style.underline) {
    codes.push("4");
  }
  if (style.inverse) {
    codes.push("7");
  }
  if (style.strikethrough) {
    codes.push("9");
  }

  if (style.fg !== undefined && style.fgMode !== undefined) {
    codes.push(...colorToSgr(style.fgMode, style.fg, false));
  }

  if (style.bg !== undefined && style.bgMode !== undefined) {
    codes.push(...colorToSgr(style.bgMode, style.bg, true));
  }

  return `\u001b[${codes.join(";")}m`;
}

function colorToSgr(mode: number, value: number, background: boolean): string[] {
  if (mode === 1) {
    if (value >= 8) {
      return [String((background ? 100 : 90) + (value - 8))];
    }
    return [String((background ? 40 : 30) + value)];
  }

  if (mode === 2) {
    return [background ? "48" : "38", "5", String(value)];
  }

  if (mode === 3) {
    return [
      background ? "48" : "38",
      "2",
      String((value >> 16) & 0xff),
      String((value >> 8) & 0xff),
      String(value & 0xff),
    ];
  }

  return [];
}
