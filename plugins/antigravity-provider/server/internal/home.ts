import os from "node:os";
import path from "node:path";
import type { ProviderLaunch, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";

// agy keeps its state under $HOME. Session env wins over launch env, matching the driver spawn.
export function agyCliHome(config: ProviderSessionConfig, launch: ProviderLaunch): string {
  const home = config.env.HOME || launch.env?.HOME || process.env.HOME || os.homedir();
  return path.join(home, ".gemini", "antigravity-cli");
}
