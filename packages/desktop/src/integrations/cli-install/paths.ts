import path from "node:path";
import { createRequire } from "node:module";
import { resolveCliShimPath } from "./path.js";
import os from "node:os";
import { app } from "electron";
import { CLI_BIN_NAME } from "../../variant.js";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

function cliBinFilename(): string {
  return process.platform === "win32" ? `${CLI_BIN_NAME}.cmd` : CLI_BIN_NAME;
}

export function getCliTargetPath(): string {
  return path.join(getLocalBinDir(), cliBinFilename());
}

export function getBundledCliShimPath(): string {
  return resolveCliShimPath({
    platform: process.platform,
    cliBinName: CLI_BIN_NAME,
    isPackaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    resolveWorkspaceCli: () => createRequire(__filename).resolve("@getpaseo/cli/bin/paseo"),
  });
}
