import path from "node:path";
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
  const cliShimFilename = cliBinFilename();

  if (process.platform === "darwin") {
    const electronExePath = app.getPath("exe");
    const appBundle = electronExePath.replace(/\/Contents\/MacOS\/.+$/, "");
    return path.join(appBundle, "Contents", "Resources", "bin", cliShimFilename);
  }

  if (process.platform === "win32") {
    const electronExePath = app.getPath("exe");
    return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
  }

  // Linux
  const electronExePath = app.getPath("exe");
  return path.join(path.dirname(electronExePath), "resources", "bin", cliShimFilename);
}
