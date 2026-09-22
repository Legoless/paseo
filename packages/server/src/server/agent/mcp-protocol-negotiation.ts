import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export interface McpProtocolRejection {
  status: 400;
  body: {
    jsonrpc: "2.0";
    id: string | number | null;
    error: {
      code: typeof UNSUPPORTED_PROTOCOL_VERSION;
      message: "Unsupported protocol version";
      data: {
        supported: readonly string[];
        requested: string;
      };
    };
  };
}

/**
 * Modern MCP clients (revision 2026-07-28 and later) send a protocol version this
 * SDK does not implement. The spec says to answer with UnsupportedProtocolVersionError
 * so the client retries on a version both sides speak.
 */
export function rejectUnsupportedMcpProtocolVersion(input: {
  protocolVersion: string | undefined;
  body: unknown;
}): McpProtocolRejection | null {
  const requested = input.protocolVersion;
  if (!requested || SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return null;
  }
  return {
    status: 400,
    body: {
      jsonrpc: "2.0",
      id: jsonRpcId(input.body),
      error: {
        code: UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: {
          supported: SUPPORTED_PROTOCOL_VERSIONS,
          requested,
        },
      },
    },
  };
}

function jsonRpcId(body: unknown): string | number | null {
  if (Array.isArray(body)) {
    for (const message of body) {
      const id = jsonRpcId(message);
      if (id !== null) return id;
    }
    return null;
  }
  if (!body || typeof body !== "object" || !("id" in body)) {
    return null;
  }
  const id = body.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}
