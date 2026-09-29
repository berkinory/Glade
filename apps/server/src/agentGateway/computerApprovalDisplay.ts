import { summarizeComputerAuditArgs } from "../computer/computerAuditLog.ts";

export function computerApprovalDisplayArgs(args: Record<string, unknown>): string {
  const summary = summarizeComputerAuditArgs(args);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(summary).filter(
        ([key]) =>
          ![
            "text",
            "value",
            "prompt_text",
            "headers",
            "authorization",
            "cookie",
            "password",
            "token",
            "secret",
          ].includes(key.toLowerCase()),
      ),
    ),
  );
}
