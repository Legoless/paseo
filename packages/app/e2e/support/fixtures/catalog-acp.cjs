const readline = require("node:readline");
const { createHash, randomUUID } = require("node:crypto");
const { appendFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const kimiFailure = process.argv[2] === "kimi-native-failure";
const model = kimiFailure
  ? { modelId: "k3", name: "K3" }
  : { modelId: "gemini-3.5-flash", name: "Gemini 3.5 Flash" };
let sessionId = "catalog-diagnostic";
let cwd = process.cwd();
let promptCount = 0;
if (kimiFailure && process.argv.includes("--version")) {
  process.stdout.write("Kimi Code 2.1.1 (ACP fixture)\n");
  process.exit(0);
}
function writeKimiTurn(reason, error) {
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const slug = normalizedCwd
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  const hash = createHash("sha256").update(normalizedCwd).digest("hex").slice(0, 12);
  const directory = path.join(
    process.env.KIMI_CODE_HOME,
    "sessions",
    `wd_${slug}_${hash}`,
    sessionId,
    "agents/main",
  );
  mkdirSync(directory, { recursive: true });
  appendFileSync(
    path.join(directory, "wire.jsonl"),
    `${JSON.stringify({ type: "turn.ended", time: Date.now(), turnId: randomUUID(), reason, error })}\n`,
  );
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result = {};
  if (request.method === "initialize")
    result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
  if (request.method === "session/new" || request.method === "session/load") {
    cwd = request.params.cwd;
    sessionId = request.params.sessionId ?? (kimiFailure ? randomUUID() : "catalog-diagnostic");
    result = {
      sessionId,
      models: {
        currentModelId: model.modelId,
        availableModels: Array.from(
          { length: kimiFailure ? 1 : Number(process.argv[2]) },
          () => model,
        ),
      },
    };
  }
  if (kimiFailure && request.method === "session/prompt") {
    promptCount += 1;
    if (promptCount === 1) {
      writeKimiTurn("failed", {
        code: "internal",
        name: "OAuthConnectionError",
        message: "OAuth request failed: fetch failed",
      });
    } else {
      writeKimiTurn("completed", null);
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Recovered Kimi reply." },
            },
          },
        })}\n`,
      );
    }
    result = { stopReason: "end_turn" };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
