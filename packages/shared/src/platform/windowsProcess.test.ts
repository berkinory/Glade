import { spawnSync as spawnChildSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as Path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prepareWindowsSafeProcess } from "./windowsProcess";

const COM_SPEC = "C:\\Windows\\System32\\cmd.exe";

const prepareOnWindows = (
  command: string,
  args: ReadonlyArray<string>,
  input: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
) =>
  prepareWindowsSafeProcess(command, args, {
    platform: "win32",
    cwd: input.cwd,
    env: { ComSpec: COM_SPEC, SystemRoot: "C:\\Windows", ...input.env },
  });

describe("windowsProcess", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(Path.join(tmpdir(), "synara-windows-resolution-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves non-Windows commands shell-free and otherwise unchanged", () => {
    expect(
      prepareWindowsSafeProcess("codex", ["app-server"], {
        platform: "darwin",
      }),
    ).toEqual({ command: "codex", args: ["app-server"], shell: false });
  });

  it("does not search the working directory unless it is on PATH", () => {
    const workingDirectory = Path.join(root, "working");
    const pathDirectory = Path.join(root, "bin");
    mkdirSync(workingDirectory);
    mkdirSync(pathDirectory);
    writeFileSync(Path.join(workingDirectory, "codex.CMD"), "@echo off\r\n");
    const commandPath = Path.join(pathDirectory, "codex.CMD");
    writeFileSync(commandPath, "@echo off\r\n");
    expect(
      prepareOnWindows("codex", [], {
        cwd: workingDirectory,
        env: { PATH: pathDirectory, PATHEXT: ".CMD" },
      }).args,
    ).toEqual(["/d", "/s", "/v:off", "/c", `call "${commandPath}"`]);
  });

  it("wraps filesystem-resolved .cmd shims through cmd.exe, skipping extensionless npm scripts", () => {
    const commandPath = Path.join(root, "codex.CMD");
    writeFileSync(Path.join(root, "codex"), "#!/bin/sh\n");
    writeFileSync(commandPath, "@echo off\r\n");
    for (const command of ["codex", Path.join(root, "codex")]) {
      expect(
        prepareOnWindows(command, ["app-server"], {
          env: { PATH: root, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        }),
      ).toEqual({
        command: COM_SPEC,
        args: ["/d", "/s", "/v:off", "/c", `call "${commandPath}" "app-server"`],
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    }
  });

  it.each([
    {
      name: "quoted command and argument tokens",
      command: "C:\\Users\\Test User\\npm\\tool.cmd",
      args: ["path with spaces", "flag=value"],
      line: 'call "C:\\Users\\Test User\\npm\\tool.cmd" "path with spaces" "flag=value"',
    },
    {
      name: "literal quotes in Codex config arguments",
      command: "C:\\tools\\codex.cmd",
      args: [
        "exec",
        "--config",
        'approval_policy="never"',
        "--config",
        'model_reasoning_effort="high"',
      ],
      line: 'call "C:\\tools\\codex.cmd" "exec" "--config" "approval_policy=""never""" "--config" "model_reasoning_effort=""high"""',
    },
    {
      name: "a path with spaces and parentheses",
      command: "C:\\Program Files (x86)\\Tool\\tool.cmd",
      args: ["--version"],
      line: 'call "C:\\Program Files (x86)\\Tool\\tool.cmd" "--version"',
    },
    {
      name: "a path with parentheses but no spaces",
      command: "C:\\tools(x86)\\codex.cmd",
      args: ["--version"],
      line: 'call "C:\\tools(x86)\\codex.cmd" "--version"',
    },
  ])("encodes one cmd.exe command line for $name", ({ command, args, line }) => {
    expect(prepareOnWindows(command, args)).toMatchObject({
      command: COM_SPEC,
      args: ["/d", "/s", "/v:off", "/c", line],
      windowsVerbatimArguments: true,
    });
  });

  it.each([
    [
      "a command with %",
      "C:\\tools\\bad%path\\codex.cmd",
      [],
      /Cannot safely execute Windows batch command/,
    ],
    [
      "an argument with &",
      "C:\\tools\\codex.cmd",
      ["one&two"],
      /Cannot safely execute Windows batch argument/,
    ],
    [
      "an argument with a line break",
      "C:\\tools\\codex.cmd",
      ["line\nbreak"],
      /Cannot safely execute Windows batch argument/,
    ],
  ])("rejects %s", (_label, command, args, error) => {
    expect(() => prepareOnWindows(command, args)).toThrow(error);
  });

  it.runIf(process.platform === "win32")(
    "preserves quoted Codex arguments through a real cmd.exe batch launch",
    () => {
      const root = mkdtempSync(Path.join(tmpdir(), "synara-windows-process-"));
      const commandDir = Path.join(root, "tools(x86)");
      const scriptPath = Path.join(commandDir, "capture.mjs");
      const commandPath = Path.join(commandDir, "codex.cmd");
      const expectedArgs = [
        "exec",
        "--config",
        'approval_policy="never"',
        "--config",
        'model_reasoning_effort="high"',
      ];

      try {
        mkdirSync(commandDir);
        writeFileSync(scriptPath, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
        writeFileSync(commandPath, `@echo off\r\n"${process.execPath}" "%~dp0capture.mjs" %*\r\n`);

        const prepared = prepareWindowsSafeProcess(commandPath, expectedArgs, {
          platform: "win32",
          env: process.env,
        });
        const result = spawnChildSync(prepared.command, prepared.args, {
          encoding: "utf8",
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: prepared.windowsVerbatimArguments,
        });

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(expectedArgs);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it("keeps resolved .exe commands direct", () => {
    const commandPath = Path.join(root, "codex.EXE");
    writeFileSync(commandPath, "native");

    expect(
      prepareWindowsSafeProcess("codex", ["--version"], {
        platform: "win32",
        cwd: "C:\\projects\\synara",
        env: { PATH: root, PATHEXT: ".EXE", SystemRoot: "C:\\Windows" },
      }),
    ).toEqual({
      command: commandPath,
      args: ["--version"],
      shell: false,
      windowsHide: true,
    });
  });

  it("keeps a configured native Codex executable path intact", () => {
    expect(
      prepareWindowsSafeProcess(
        "C:\\Users\\test\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
        ["app-server"],
        {
          platform: "win32",
          cwd: "C:\\projects\\synara",
          env: { SystemRoot: "C:\\Windows" },
        },
      ),
    ).toEqual({
      command: "C:\\Users\\test\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe",
      args: ["app-server"],
      shell: false,
      windowsHide: true,
    });
  });
});
