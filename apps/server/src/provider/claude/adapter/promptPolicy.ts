import type { SettingSource } from "@anthropic-ai/claude-agent-sdk";
import { renderGladeHarnessPolicy } from "../../../agentGateway/harnessPolicy.ts";

export const CLAUDE_SETTING_SOURCES = [
  "user",
  "project",
  "local",
] as const satisfies ReadonlyArray<SettingSource>;

export const buildEmbeddedClaudeSystemPromptAppend = (gatewayControlAvailable: boolean) =>
  [
    "This session uses the Claude Agent SDK inside Glade. Glade is the host app; Claude Code is not the host app's name.\nUse the current working directory as the active workspace. For questions about this repository, inspect its files before asking the user for information the workspace can provide.\nApply the shared Glade harness policy alongside the Claude coding-agent instructions.",
    renderGladeHarnessPolicy({ gatewayControlAvailable }),
    ...(gatewayControlAvailable
      ? [
          "Glade MCP tools are exposed to Claude as mcp__glade__<canonical_name>, for example mcp__glade__html_render, mcp__glade__html_preview and mcp__glade__glade_capabilities. When a tool is deferred, use ToolSearch with select:<full_tool_name> to load its schema before calling it. Search for the exact Glade tool before claiming it is missing; tools from other MCP servers do not replace Glade host tools.",
        ]
      : []),
  ].join("\n\n");
