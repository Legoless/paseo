import { describe, expect, test } from "vitest";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

import { rejectUnsupportedMcpProtocolVersion } from "./mcp-protocol-negotiation.js";

describe("rejectUnsupportedMcpProtocolVersion", () => {
  test("asks a 2026-07-28 client to retry on a version this server speaks", () => {
    expect(
      rejectUnsupportedMcpProtocolVersion({
        protocolVersion: "2026-07-28",
        body: { jsonrpc: "2.0", id: 7, method: "tools/list" },
      }),
    ).toEqual({
      status: 400,
      body: {
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32022,
          message: "Unsupported protocol version",
          data: {
            supported: SUPPORTED_PROTOCOL_VERSIONS,
            requested: "2026-07-28",
          },
        },
      },
    });
  });

  test("lets a supported protocol version through", () => {
    expect(
      rejectUnsupportedMcpProtocolVersion({
        protocolVersion: "2025-11-25",
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      }),
    ).toBeNull();
  });
});
