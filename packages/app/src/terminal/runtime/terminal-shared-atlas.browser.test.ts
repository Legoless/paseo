import { afterEach, expect, it } from "vitest";
import { encodeTerminalOutput, TerminalEmulatorRuntime } from "./terminal-emulator-runtime";

// Real @xterm/addon-webgl, no mock: embedded terminals in one window share one WebGL glyph
// atlas, so one terminal clearing it blanks the unchanged text of every other terminal.

interface WebglRendererInternals {
  _charAtlas?: object;
  _canvas: HTMLCanvasElement;
  renderRows: (start: number, end: number) => void;
}

interface TerminalInternals {
  rows: number;
  buffer: { active: { getLine: (y: number) => { translateToString: (trim: boolean) => string } } };
  clearTextureAtlas: () => void;
  _core: {
    _renderService: {
      _renderer: { value?: WebglRendererInternals } & Partial<WebglRendererInternals>;
    };
  };
}

const THEME = { background: "#000000", foreground: "#ffffff" };
const mounted: Array<{ runtime: TerminalEmulatorRuntime; root: HTMLDivElement }> = [];

afterEach(() => {
  for (const { runtime, root } of mounted.splice(0)) {
    runtime.unmount();
    root.remove();
  }
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5000) throw new Error("timed out waiting for WebGL");
    await nextFrame();
  }
}

function mount(left: number, resetTextureAtlasOnFirstSnapshot?: boolean): TerminalEmulatorRuntime {
  const root = document.createElement("div");
  Object.assign(root.style, {
    position: "fixed",
    left: `${left}px`,
    top: "0px",
    width: "420px",
    height: "200px",
  });
  const host = document.createElement("div");
  Object.assign(host.style, { width: "100%", height: "100%" });
  root.appendChild(host);
  document.body.appendChild(root);
  const runtime = new TerminalEmulatorRuntime();
  runtime.mount({
    root,
    host,
    initialSnapshot: null,
    scrollback: 100,
    theme: THEME,
    resetTextureAtlasOnFirstSnapshot,
  });
  mounted.push({ runtime, root });
  return runtime;
}

function terminalOf(runtime: TerminalEmulatorRuntime): TerminalInternals {
  return (runtime as unknown as { terminal: TerminalInternals }).terminal;
}

function rendererOf(runtime: TerminalEmulatorRuntime): WebglRendererInternals | undefined {
  const renderer = terminalOf(runtime)._core._renderService._renderer;
  return renderer.value ?? (renderer as WebglRendererInternals);
}

// Repaints every row the way the terminal's next frame would, then counts lit pixels.
function litPixels(runtime: TerminalEmulatorRuntime): number {
  const renderer = rendererOf(runtime)!;
  renderer.renderRows(0, terminalOf(runtime).rows - 1);
  const copy = document.createElement("canvas");
  copy.width = renderer._canvas.width;
  copy.height = renderer._canvas.height;
  const context = copy.getContext("2d")!;
  context.drawImage(renderer._canvas, 0, 0);
  const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
  let lit = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 90) lit += 1;
  }
  return lit;
}

function coloredRow(row: number): string {
  return `\x1b[${row};1H\x1b[38;2;${40 + row * 9};${220 - row * 7};200mline ${row}: The quick brown fox jumps over the lazy dog\x1b[0m`;
}

it("keeps an embedded terminal's text when another terminal mounts", async () => {
  const first = mount(0);
  await waitFor(() => Boolean(rendererOf(first)?._charAtlas));
  first.restoreOutput({
    data: encodeTerminalOutput(
      Array.from({ length: 10 }, (_, index) => coloredRow(index + 1)).join(""),
    ),
  });
  await frames(6);
  const before = litPixels(first);

  const second = mount(440);
  await waitFor(() => Boolean(rendererOf(second)?._charAtlas));
  expect(rendererOf(second)?._charAtlas).toBe(rendererOf(first)?._charAtlas);
  second.restoreOutput({
    data: encodeTerminalOutput("\x1b[35mlegoless\x1b[0m at \x1b[33mLegoBrain\x1b[0m\r\n$ "),
  });
  await frames(6);

  expect(terminalOf(first).buffer.active.getLine(0).translateToString(true)).toContain("line 1");
  expect(before).toBeGreaterThan(1000);
  expect(litPixels(first)).toBeGreaterThan(before * 0.9);
});

it("resets the atlas once for a terminal that owns its renderer", async () => {
  const guest = mount(0, true);
  await waitFor(() => Boolean(rendererOf(guest)?._charAtlas));
  const terminal = terminalOf(guest);
  const clearTextureAtlas = terminal.clearTextureAtlas.bind(terminal);
  let clears = 0;
  terminal.clearTextureAtlas = () => {
    clears += 1;
    clearTextureAtlas();
  };

  guest.restoreOutput({ data: encodeTerminalOutput("$ ") });
  await frames(3);
  guest.restoreOutput({ data: encodeTerminalOutput("$ again") });
  await frames(3);

  expect(clears).toBe(1);
});
