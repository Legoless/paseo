# Terminal performance

How terminal output stays low-latency, what the invariants are, and how to measure before/after any change to the pipeline. Read this before touching anything under `packages/server/src/terminal/` or `packages/app/src/terminal/runtime/`.

## The pipeline

```
pty (node-pty, forked worker process)
  → headless xterm parse (worker, snapshot fidelity)
  → TerminalOutputCoalescer (worker, ≤1 IPC message per 5ms per terminal)
  → process.send IPC → daemon main process
  → TerminalOutputCoalescer (per client stream, terminal-session-controller.ts)
  → binary ws frame (2-byte header + raw bytes)
  → client decode (daemon-client.ts) → stream router → emulator runtime
  → xterm.write (back-to-back; xterm batches internally)
```

With the isolated renderer enabled (Electron desktop, Settings → Diagnostics → **Isolated terminal renderer**), the client tail forks per terminal:

```
  → stream router → TerminalPane relay (main renderer, 1:1 passthrough)
  → webview.send / ipc-message → guest renderer process (public/terminal-guest.html)
  → same emulator runtime → xterm.write
```

A terminal guest crash or hang then kills one tab, not the app: the stream subscription and daemon session live in the main renderer and survive the guest. The tradeoff is one extra JSON message per terminal event across IPC; the daemon coalescer still bounds the rate, so the hop is flat, not compounding. If profiling ever shows the hop matters, the guest can subscribe to the daemon directly — the seam is the per-terminal emulator creation in `terminal-pane.tsx`, no UI change needed.

Terminal frames share the daemon main event loop with all agent traffic. The `eventLoopDelay` block in the `ws_runtime_metrics` log line (every 30s in `daemon.log`) is the ground truth for "the daemon is busy" — p99/max there directly bound worst-case terminal frame delay.

## Invariants (the easy-to-break ones)

- **Coalescers are leading+trailing throttles.** The first chunk after an idle window flushes immediately (synchronously); only sustained bursts wait for the trailing timer. Reverting to trailing-only adds a full window (~5ms) to every keystroke echo.
- **Output coalescing happens in the worker, before IPC.** One `process.send` per pty chunk was a main-loop flood under build output. Non-output messages (snapshot/snapshotReady/titleChange/exit) must flush the coalescer first so ordering is preserved.
- **Coalesced output carries the LAST chunk's revision.** Snapshot replay dedup (`replayTerminalOutputAfterSnapshot`) skips buffered output with `revision <= replayRevision`; a merged batch with a lower revision would be wrongly skipped (lost output).
- **The input-mode tracker runs once per process boundary, not per hop.** The worker owns the authoritative tracker; the daemon caches the replay preamble from `getTerminalState` responses and `snapshotReady` messages. Do not reintroduce a per-chunk `feed()` on the daemon main loop.
- **Snapshot catch-up is backpressure-gated.** A stream falls back to a full snapshot only when `outputBytesSinceSnapshot > MAX_TERMINAL_OUTPUT_FRAME_BYTES` (256KB) **and** the client transport reports `bufferedAmount > MAX_CLIENT_BUFFERED_BYTES` (4MB). A client that keeps draining streams continuously, no matter how much output is produced. Before this gate existed, every 256KB of build output dropped a frame and forced a full JSON cell-grid snapshot (~200k objects across IPC) — the historical source of spiky lag and GC hitches.
- **Plugin daemon sessions report IPC queue bytes.** Their virtual socket increments `bufferedAmount` before `process.send` and decrements it only in the send callback. Text and binary frames share that ordered queue, so the normal snapshot catch-up and physical high-water gates remain valid for server-side plugin SDK traffic.
- **Client output writes are not serialized per frame.** The emulator runtime drains contiguous plain writes straight into xterm (which buffers internally). Only barrier ops (`clear`, `snapshot`, `suppressInput` writes) wait — behind a zero-length sentinel write — so resets can't interleave with in-flight output.
- **Find preserves the inspected xterm viewport, including at the live bottom.** Keep its output anchor inside the existing batched write path. Serializing output to preserve a search result would add terminal latency.
- **Retained terminal tabs in the focused workspace keep their streams.** Hidden mounted terminals continue applying output, so switching tabs does not resubscribe or request a fresh snapshot. The retained-panel LRU bounds the number of live streams; terminals in an unfocused workspace detach.
- **The isolated-renderer relay adds no second coalescing window.** Coalescing stays in the daemon; the main renderer forwards one decoded stream event as one guest message. A second window anywhere on the relay breaks the leading-edge flush.
- **A guest reload or eviction must re-create the stream subscription.** The daemon dedups re-sends by stream revision, and the pane's snapshot cache can be empty (`handleStreamRestore` clears it), so reusing the existing subscription after a remount restores nothing — the guest stays blank. `onGuestReloaded` bumps the pane's stream-reset nonce through both stream effects, which is the same path a fresh page load takes.
- **Hang detection for guests is the heartbeat, not the OS.** Electron 41 fires no `unresponsive` for a hung webview guest (verified: minutes of a blocked guest, no DOM event, no WebContents event). The guest pings every 2s and the pane marks it hung after 5s of silence. `render-process-gone` still fires for crashes; `clean-exit` is teardown, never a crash.
- **A fresh guest surface paints blank until two kicks land.** The xterm canvas glyph atlas is invalid on a newly attached renderer surface — the runtime resets it at the first snapshot commit (`needsTextureAtlasReset`). And an idle host issues the guest no BeginFrames, so content can sit painted-but-unpresented: the pane invalidates the host container once after the first content message, and the main process calls `webContents.invalidate()` at +300ms/+1200ms after `did-finish-load`.

## Isolated renderer boundary (Electron desktop)

Off-Electron, everything above collapses to the embedded renderer — the `.web`/native stubs of `packages/app/src/desktop/terminal/pane/` are never reached behind the gate. With the gate on:

- Each terminal tab is a `<webview>` running `terminal-guest.html` in its own renderer process. The attach guard in `packages/desktop/src/main.ts` admits only the same-origin guest URL and forces the sandboxed preload.
- A crashed or hung guest shows an in-tab reload affordance (`guest-lifecycle.ts`); reload remounts, re-subscribes, and resumes the live stream. Other tabs never see it.
- Live guests are LRU-capped at 8 (`isolated-terminal-guest-budget.ts`); evicting the eldest unmounts its webview, and presenting the tab remounts through the reload path. The cap exists because each guest costs a process (~30–80MB); make it a setting only if users ask.
- On macOS the compositor watchdog (`packages/desktop/src/window/compositor-watchdog/`) probes guests as additional targets of the same global GPU-restart recovery as the main window.
- **Terminal size has one daemon-owned claimant.** Focus and direct interaction send a `claim`; later geometry changes from that connection send `update`. A claim transfers ownership even when the dimensions are unchanged, while an update from any other connection is ignored. This lets an owning pane follow splits and keyboard insets without allowing an idle phone or browser to steal the PTY size.

## Measuring

- **Node-only benchmark (fast iteration, server pipeline):** `npx tsx scripts/benchmark-terminal-latency.ts`. Boots an isolated daemon (fresh `PASEO_HOME`, random port — never 6767), measures echo latency percentiles, burst jitter, and snapshot counts under ramped mock-agent load. Writes JSON to `/tmp/paseo-terminal-bench/`. Healthy numbers (2026-06): echo p50 ~2.3ms, p95 ~3.3ms, a 2MB burst fully streamed with `snap=0`.
- **Browser perf specs (user-perceived path):** gated behind `PASEO_TERMINAL_PERF_E2E=1` —
  `packages/app/e2e/browser/terminal-performance.spec.ts` and `packages/app/e2e/browser/terminal-keystroke-stress.spec.ts` (per-stage keydown→xterm-commit breakdown under mock-agent load). Healthy: keydown→commit p50 ~18ms under 600-key burst.
- **Production:** grep `daemon.log` for `ws_runtime_metrics` and read `eventLoopDelay` + `bufferedAmount`.
- **Git pressure:** the same log line includes `git.commands` (limiter occupancy, queue age,
  queue wait, execution time, failures, timeouts, and top operations),
  `git.workspaceService` (daemon-global Git observer ownership), and per-session workspace Git
  subscription totals under `runtime`. Queue wait and execution time are separate because the Git
  command timeout begins only after a command acquires a limiter slot.

## Known remaining contention (follow-up candidates)

- A single large `agent_stream` message (e.g. a 250KB diff payload) measurably delays terminal echo (~100ms-class dips) — cost is split between daemon serialization and app-side parse/render on the shared browser main thread. See [agent-stream-performance.md](agent-stream-performance.md) for that pipeline's own budgets.
- Relay-attached clients pay pure-JS tweetnacl encryption on the daemon main loop (`packages/relay/src/encrypted-channel.ts`). Negotiated binary application frames stay binary ciphertext and avoid base64 encode/decode; text and mixed-version traffic remain base64 WebSocket text frames.
- `sendToClient` re-stringifies session messages per socket; only matters for multi-socket connections.
