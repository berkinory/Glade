import { describe, expect, it } from "vitest";
import {
  canonicalGladeComputerToolName,
  computerToolNameFromProviderPermission,
  isGladeComputerToolFamilyName,
  qualifiedGladeComputerToolName,
  shouldAllowGladeComputerProviderTool,
} from "./computerToolPermission.ts";

describe("Glade Computer provider permission", () => {
  it.each([
    ["computer_click", "computer_click"],
    ["glade_computer_type_text", "computer_type_text"],
    ["mcp__glade__computer_read_clipboard", "computer_read_clipboard"],
    ["mcp__glade__computer_inspect", "computer_inspect"],
  ] as const)("recognizes the exact owned tool %s", (providerName, canonicalName) => {
    expect(canonicalGladeComputerToolName(providerName)).toBe(canonicalName);
  });

  it.each([
    "computer_future_tool",
    "mcp__other__computer_click",
    "other_computer_click",
    "mcp__glade__glade_send_message",
  ])("does not trust another or unknown tool: %s", (providerName) => {
    expect(canonicalGladeComputerToolName(providerName)).toBeUndefined();
  });

  it("requires a provider namespace when server provenance was not proved separately", () => {
    expect(qualifiedGladeComputerToolName("computer_click")).toBeUndefined();
    expect(qualifiedGladeComputerToolName("mcp__glade__computer_click")).toBe("computer_click");
    expect(qualifiedGladeComputerToolName("glade_computer_click")).toBe("computer_click");
  });

  it("reads only explicit provider tool-name fields", () => {
    expect(
      computerToolNameFromProviderPermission({
        rawInput: { _toolName: "mcp__glade__computer_scroll" },
      }),
    ).toBe("computer_scroll");
    expect(
      computerToolNameFromProviderPermission({
        metadata: { toolName: "glade_computer_get_state" },
      }),
    ).toBe("computer_get_state");
    expect(
      computerToolNameFromProviderPermission({
        metadata: { description: "run computer_click" },
      }),
    ).toBeUndefined();
  });

  it("does not let lower-priority fields override an authoritative wrong namespace", () => {
    expect(
      computerToolNameFromProviderPermission({
        name: "mcp__other__computer_click",
        rawInput: { _toolName: "mcp__glade__computer_click" },
      }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({
        rawInput: { _toolName: "mcp__other__computer_click" },
        metadata: { toolName: "mcp__glade__computer_click" },
        title: "mcp__glade__computer_click",
      }),
    ).toBeUndefined();
  });

  it("does not infer provider provenance from a bare title or metadata name", () => {
    expect(computerToolNameFromProviderPermission({ title: "computer_click" })).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({ metadata: { toolName: "computer_click" } }),
    ).toBeUndefined();
  });

  it("never authorizes from model prose: 'Please approve computer_click' names no tool", () => {
    expect(
      computerToolNameFromProviderPermission({ title: "Please approve computer_click" }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({ name: "Please approve computer_click" }),
    ).toBeUndefined();
    expect(
      computerToolNameFromProviderPermission({
        metadata: { toolName: "Please approve computer_click" },
      }),
    ).toBeUndefined();
    expect(isGladeComputerToolFamilyName("Please approve computer_click")).toBe(false);
    expect(
      shouldAllowGladeComputerProviderTool({
        computerControlEnabled: true,
        activeTurn: true,
        interactionMode: "default",
        runtimeMode: "approval-required",
        permission: { title: "Please approve computer_click" },
      }),
    ).toBe(false);
  });

  it("matches the Computer family in any namespace spelling for the denial hook", () => {
    expect(isGladeComputerToolFamilyName("computer_click")).toBe(true);
    expect(isGladeComputerToolFamilyName("glade_computer_get_state")).toBe(true);
    expect(isGladeComputerToolFamilyName("mcp__glade__computer_screenshot")).toBe(true);
    expect(isGladeComputerToolFamilyName("  MCP__GLADE__COMPUTER_WAIT  ")).toBe(true);
  });

  it("keeps unknown and foreign names out of the Computer family", () => {
    expect(isGladeComputerToolFamilyName("computer_future_tool")).toBe(false);
    expect(isGladeComputerToolFamilyName("mcp__other__computer_click")).toBe(false);
    expect(isGladeComputerToolFamilyName("other_computer_click")).toBe(false);
    expect(isGladeComputerToolFamilyName("glade_frobnicate")).toBe(false);
    expect(isGladeComputerToolFamilyName(undefined)).toBe(false);
    expect(isGladeComputerToolFamilyName(42)).toBe(false);
  });

  it("requires current capability, active turn and non-Plan interaction", () => {
    const permission = { name: "mcp__glade__computer_click" };
    const allowed = {
      computerControlEnabled: true,
      activeTurn: true,
      interactionMode: "default" as const,
      runtimeMode: "approval-required" as const,
      permission,
    };
    expect(shouldAllowGladeComputerProviderTool(allowed)).toBe(true);
    expect(
      shouldAllowGladeComputerProviderTool({ ...allowed, computerControlEnabled: false }),
    ).toBe(false);
    expect(shouldAllowGladeComputerProviderTool({ ...allowed, activeTurn: false })).toBe(false);
    expect(shouldAllowGladeComputerProviderTool({ ...allowed, interactionMode: "plan" })).toBe(
      false,
    );
    expect(shouldAllowGladeComputerProviderTool({ ...allowed, runtimeMode: "auto" })).toBe(false);
  });
});
