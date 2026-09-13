import { contextBridge, ipcRenderer } from "electron";

// This preload runs in Electron's sandbox and is tsc-compiled (not bundled), so it MUST NOT emit
// any runtime module load other than "electron" — a require() of a local or third-party module
// throws and aborts the preload before exposeInMainWorld runs. Keep it literal, like
// features/browser-keyboard/guest-preload.ts.
const HOST_MESSAGE_CHANNEL = "paseo:terminal-guest-message";

contextBridge.exposeInMainWorld("__PASEO_TERMINAL_TRANSPORT__", "electron");
contextBridge.exposeInMainWorld("__PASEO_TERMINAL_GUEST__", {
  sendToHost: (channel: string, message: string) => {
    ipcRenderer.sendToHost(channel, message);
  },
  onHostMessage: (handler: (message: string) => void) => {
    ipcRenderer.on(HOST_MESSAGE_CHANNEL, (_event, message: unknown) => {
      if (typeof message === "string") {
        handler(message);
      }
    });
  },
});
