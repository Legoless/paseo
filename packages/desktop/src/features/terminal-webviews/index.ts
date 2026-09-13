const TERMINAL_GUEST_PATH = "/terminal-guest.html";

export const TERMINAL_GUEST_STATE_EVENT = "paseo:event:terminal-guest-state";

export type TerminalGuestState = "unresponsive" | "responsive";

export interface TerminalGuestStateEvent {
  webContentsId: number;
  state: TerminalGuestState;
}

interface TerminalWebContentsIdentity {
  readonly id: number;
  isDestroyed(): boolean;
}

interface RegisteredTerminalWebContents extends TerminalWebContentsIdentity {
  setBackgroundThrottling(allowed: boolean): void;
  once(event: "destroyed", listener: () => void): void;
  on(event: "did-finish-load", listener: () => void): void;
  invalidate(): void;
}

interface ObservableTerminalGuest extends TerminalWebContentsIdentity {
  on(event: "unresponsive" | "responsive", listener: () => void): void;
}

interface TerminalGuestStateHost {
  send(channel: string, payload: TerminalGuestStateEvent): void;
}

/**
 * Minimal terminal-guest registry. Slice 1 only needs the attach predicate and throttling
 * preparation; the registry is the seam later slices use to map a guest back to its terminal.
 */
export class PaseoTerminalWebviewRegistry {
  private readonly terminalIdsByWebContentsId = new Map<number, string>();
  private readonly webContentsIdsByTerminalId = new Map<string, number>();

  public register(input: { terminalId: string; webContentsId: number }): void {
    const replacedWebContentsId = this.webContentsIdsByTerminalId.get(input.terminalId);
    if (replacedWebContentsId !== undefined && replacedWebContentsId !== input.webContentsId) {
      this.terminalIdsByWebContentsId.delete(replacedWebContentsId);
    }
    const replacedTerminalId = this.terminalIdsByWebContentsId.get(input.webContentsId);
    if (replacedTerminalId !== undefined && replacedTerminalId !== input.terminalId) {
      this.webContentsIdsByTerminalId.delete(replacedTerminalId);
    }
    this.terminalIdsByWebContentsId.set(input.webContentsId, input.terminalId);
    this.webContentsIdsByTerminalId.set(input.terminalId, input.webContentsId);
  }

  public unregisterWebContents(webContentsId: number): void {
    const terminalId = this.terminalIdsByWebContentsId.get(webContentsId);
    if (terminalId === undefined) {
      return;
    }
    this.terminalIdsByWebContentsId.delete(webContentsId);
    if (this.webContentsIdsByTerminalId.get(terminalId) === webContentsId) {
      this.webContentsIdsByTerminalId.delete(terminalId);
    }
  }

  public unregisterTerminal(terminalId: string): void {
    const webContentsId = this.webContentsIdsByTerminalId.get(terminalId);
    if (webContentsId === undefined) {
      return;
    }
    this.webContentsIdsByTerminalId.delete(terminalId);
    if (this.terminalIdsByWebContentsId.get(webContentsId) === terminalId) {
      this.terminalIdsByWebContentsId.delete(webContentsId);
    }
  }

  public getTerminalIdForWebContents(webContentsId: number): string | null {
    return this.terminalIdsByWebContentsId.get(webContentsId) ?? null;
  }

  public getWebContentsIdForTerminal(terminalId: string): number | null {
    return this.webContentsIdsByTerminalId.get(terminalId) ?? null;
  }

  public listTerminalIds(): string[] {
    return Array.from(this.webContentsIdsByTerminalId.keys()).sort();
  }
}

const terminalRegistry = new PaseoTerminalWebviewRegistry();

export function getPaseoTerminalWebviewRegistry(): PaseoTerminalWebviewRegistry {
  return terminalRegistry;
}

function isTerminalGuestUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (parsed.pathname !== TERMINAL_GUEST_PATH) {
      return false;
    }
    if (parsed.protocol === "paseo:") {
      return parsed.host === "app";
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    }
    return false;
  } catch {
    return false;
  }
}

export function isPaseoTerminalWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return isTerminalGuestUrl(input.src);
}

export function preparePaseoTerminalWebContents(contents: RegisteredTerminalWebContents): void {
  const webContentsId = contents.id;
  contents.setBackgroundThrottling(false);
  contents.once("destroyed", () => {
    terminalRegistry.unregisterWebContents(webContentsId);
  });
  // An idle host issues the guest no BeginFrames, so a freshly attached terminal guest can
  // sit painted-but-unpresented until the next user input. Invalidate twice after load: once
  // for the shell, once after the daemon's restore stream has had time to land.
  contents.on("did-finish-load", () => {
    for (const delayMs of [300, 1200]) {
      setTimeout(() => {
        if (!contents.isDestroyed()) {
          contents.invalidate();
        }
      }, delayMs);
    }
  });
}

/**
 * The `<webview>` element does not expose `unresponsive`/`responsive` DOM events, so the main
 * process observes the guest WebContents and forwards the state to the host renderer. The guest URL
 * carries no terminal id, so the payload is keyed by guest WebContents id and the pane matches it
 * against its own `getWebContentsId()`.
 */
export function observePaseoTerminalGuestState(
  contents: ObservableTerminalGuest,
  host: TerminalGuestStateHost,
): void {
  const forward = (state: TerminalGuestState) => {
    if (contents.isDestroyed()) {
      return;
    }
    host.send(TERMINAL_GUEST_STATE_EVENT, { webContentsId: contents.id, state });
  };
  contents.on("unresponsive", () => forward("unresponsive"));
  contents.on("responsive", () => forward("responsive"));
}
