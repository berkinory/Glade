import { assert, describe, it } from "@effect/vitest";

import {
  buildClaudeMcpServers,
  callAgentGatewayMcpTool,
  listAgentGatewayMcpTools,
} from "./mcpInjection.ts";

const connection = {
  url: "http://127.0.0.1:3773/mcp",
  bearerToken: "sagw_abc.def",
};

describe("agent gateway MCP injection", () => {
  it("builds a claude http server entry with the bearer header", () => {
    const servers = buildClaudeMcpServers(connection);
    assert.deepEqual(servers, {
      glade: {
        type: "http",
        url: connection.url,
        headers: { Authorization: `Bearer ${connection.bearerToken}` },
      },
    });
  });

  it("loads and invokes the canonical gateway catalog for native-tool providers", async () => {
    const requests: Array<{ readonly authorization: string | null; readonly body: unknown }> = [];
    const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body,
      });
      const request = body as { readonly id: string; readonly method: string };
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "glade_list_threads",
                    description: "List Glade threads.",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              }
            : { content: [{ type: "text", text: "ok" }] },
      });
    };

    assert.deepEqual(await listAgentGatewayMcpTools({ connection, fetch }), [
      {
        name: "glade_list_threads",
        description: "List Glade threads.",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    assert.deepEqual(
      await callAgentGatewayMcpTool({
        connection,
        name: "glade_list_threads",
        arguments: { limit: 2 },
        fetch,
      }),
      { content: [{ type: "text", text: "ok" }] },
    );
    assert.deepEqual(
      requests.map((request) => request.authorization),
      [`Bearer ${connection.bearerToken}`, `Bearer ${connection.bearerToken}`],
    );
    assert.deepEqual((requests[1]!.body as { readonly params: unknown }).params, {
      name: "glade_list_threads",
      arguments: { limit: 2 },
    });
  });
});
