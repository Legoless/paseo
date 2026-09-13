/**
 * LRU budget for live isolated terminal guests. Every mounted `<webview>` is a renderer process,
 * so the pane registers each guest here and unmounts the least-recently-used one when the cap is
 * exceeded. The tab stays in the tab bar; the guest remounts (and replays its snapshot) on next
 * present. The policy is pure so the eviction order is testable without Electron.
 */

// ponytail: fixed guest budget; make a setting only if users ask
export const ISOLATED_TERMINAL_GUEST_BUDGET = 8;

export interface IsolatedTerminalGuestBudgetState {
  /** Guest keys, most-recently-used first. */
  order: readonly string[];
}

export const EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET: IsolatedTerminalGuestBudgetState = {
  order: [],
};

export interface IsolatedTerminalGuestBudgetUpdate {
  state: IsolatedTerminalGuestBudgetState;
  /** Guests pushed past the cap, least-recently-used first. */
  evicted: readonly string[];
}

/**
 * Mark a guest as most-recently-used and return the guests pushed past the cap. A non-positive cap
 * still keeps one guest so a misconfigured budget can never evict the guest that just mounted.
 */
export function touchIsolatedTerminalGuest(
  state: IsolatedTerminalGuestBudgetState,
  key: string,
  cap: number = ISOLATED_TERMINAL_GUEST_BUDGET,
): IsolatedTerminalGuestBudgetUpdate {
  const maxSize = Math.max(1, Math.floor(cap));
  const order = [key, ...state.order.filter((entry) => entry !== key)];
  return {
    state: { order: order.slice(0, maxSize) },
    evicted: order.slice(maxSize),
  };
}

export function removeIsolatedTerminalGuest(
  state: IsolatedTerminalGuestBudgetState,
  key: string,
): IsolatedTerminalGuestBudgetState {
  if (!state.order.includes(key)) {
    return state;
  }
  return { order: state.order.filter((entry) => entry !== key) };
}

export interface IsolatedTerminalGuestBudget {
  /** Register/touch a guest; returns the evicted keys and notifies subscribers. */
  present(key: string): readonly string[];
  /** Drop a guest that is no longer mounted. */
  release(key: string): void;
  subscribe(listener: (evicted: readonly string[]) => void): () => void;
  snapshot(): readonly string[];
}

export function createIsolatedTerminalGuestBudget(
  cap: number = ISOLATED_TERMINAL_GUEST_BUDGET,
): IsolatedTerminalGuestBudget {
  let state = EMPTY_ISOLATED_TERMINAL_GUEST_BUDGET;
  const listeners = new Set<(evicted: readonly string[]) => void>();
  return {
    present(key) {
      const update = touchIsolatedTerminalGuest(state, key, cap);
      state = update.state;
      if (update.evicted.length > 0) {
        for (const listener of listeners) {
          listener(update.evicted);
        }
      }
      return update.evicted;
    },
    release(key) {
      state = removeIsolatedTerminalGuest(state, key);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      return state.order;
    },
  };
}
