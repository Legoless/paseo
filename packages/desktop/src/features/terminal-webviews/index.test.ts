import { describe, expect, test } from "vitest";
import {
  TERMINAL_GUEST_STATE_EVENT,
  getPaseoTerminalWebviewRegistry,
  isPaseoTerminalWebviewAttach,
  observePaseoTerminalGuestState,
  preparePaseoTerminalWebContents,
  type TerminalGuestStateEvent,
} from "./index.js";

class FakeTerminalGuest {
  public readonly backgroundThrottlingCalls: boolean[] = [];
  private destroyedListener: (() => void) | null = null;
  private destroyed = false;

  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public setBackgroundThrottling(allowed: boolean): void {
    this.backgroundThrottlingCalls.push(allowed);
  }

  public once(event: "destroyed", listener: () => void): void {
    expect(event).toBe("destroyed");
    this.destroyedListener = listener;
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyedListener?.();
  }
}

describe("terminal webview attachment", () => {
  test("accepts the terminal guest URL on any partition", () => {
    expect(isPaseoTerminalWebviewAttach({ src: "paseo://app/terminal-guest.html" })).toBe(true);
    expect(
      isPaseoTerminalWebviewAttach({
        src: "http://localhost:8081/terminal-guest.html",
        partition: "persist:anything",
      }),
    ).toBe(true);
    expect(isPaseoTerminalWebviewAttach({ src: "http://127.0.0.1:8081/terminal-guest.html" })).toBe(
      true,
    );
  });

  test("rejects non-guest URLs", () => {
    expect(isPaseoTerminalWebviewAttach({ src: "https://example.com/terminal-guest.html" })).toBe(
      false,
    );
    expect(isPaseoTerminalWebviewAttach({ src: "paseo://app/index.html" })).toBe(false);
    expect(isPaseoTerminalWebviewAttach({ src: "http://localhost:8081/other.html" })).toBe(false);
    expect(isPaseoTerminalWebviewAttach({ src: undefined })).toBe(false);
  });

  test("prepares throttling once and removes registration when the guest is destroyed", () => {
    const registry = getPaseoTerminalWebviewRegistry();
    const guest = new FakeTerminalGuest(701);
    registry.register({ terminalId: "terminal-cleanup", webContentsId: guest.id });

    preparePaseoTerminalWebContents(guest);

    expect(guest.backgroundThrottlingCalls).toEqual([false]);
    expect(registry.getTerminalIdForWebContents(guest.id)).toBe("terminal-cleanup");

    guest.destroy();

    expect(registry.getTerminalIdForWebContents(guest.id)).toBeNull();
    expect(guest.backgroundThrottlingCalls).toEqual([false]);
  });

  test("keeps one webContents per terminal id", () => {
    const registry = getPaseoTerminalWebviewRegistry();
    registry.register({ terminalId: "terminal-a", webContentsId: 801 });
    registry.register({ terminalId: "terminal-a", webContentsId: 802 });

    expect(registry.getWebContentsIdForTerminal("terminal-a")).toBe(802);
    expect(registry.getTerminalIdForWebContents(801)).toBeNull();
    expect(registry.getTerminalIdForWebContents(802)).toBe("terminal-a");

    registry.unregisterTerminal("terminal-a");
    expect(registry.getWebContentsIdForTerminal("terminal-a")).toBeNull();
  });
});

class FakeObservableTerminalGuest {
  private readonly listeners = new Map<string, Array<() => void>>();
  private destroyed = false;

  public constructor(public readonly id: number) {}

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public on(event: "unresponsive" | "responsive", listener: () => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  public emit(event: "unresponsive" | "responsive"): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  public destroy(): void {
    this.destroyed = true;
  }
}

describe("terminal guest state forwarding", () => {
  test("forwards unresponsive and responsive to the host renderer", () => {
    const guest = new FakeObservableTerminalGuest(901);
    const sent: Array<{ channel: string; payload: TerminalGuestStateEvent }> = [];
    observePaseoTerminalGuestState(guest, {
      send: (channel, payload) => sent.push({ channel, payload }),
    });

    guest.emit("unresponsive");
    guest.emit("responsive");

    expect(sent).toEqual([
      {
        channel: TERMINAL_GUEST_STATE_EVENT,
        payload: { webContentsId: 901, state: "unresponsive" },
      },
      {
        channel: TERMINAL_GUEST_STATE_EVENT,
        payload: { webContentsId: 901, state: "responsive" },
      },
    ]);
  });

  test("drops events from a destroyed guest", () => {
    const guest = new FakeObservableTerminalGuest(902);
    const sent: TerminalGuestStateEvent[] = [];
    observePaseoTerminalGuestState(guest, {
      send: (_channel, payload) => sent.push(payload),
    });

    guest.destroy();
    guest.emit("unresponsive");

    expect(sent).toEqual([]);
  });
});
