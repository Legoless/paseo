// Defensive stub: the isolated renderer is Electron-only, so plain web never reaches this module.
// It renders the existing embedded emulator unchanged.
export { default as IsolatedTerminalEmulator } from "@/components/terminal-emulator";
