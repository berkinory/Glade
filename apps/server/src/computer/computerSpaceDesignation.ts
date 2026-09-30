import type { OrchestrationMessage } from "@glade/contracts/orchestration/orchestration";

import { latestUserAuthoredMessage } from "./computerVisibleUse.ts";

// Mission Control positions, quoted examples, provider output and automation messages never grant
// this scope.
function messageDesignatesComputerSpaces(text: string): readonly number[] {
  const request = text
    .replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”\n]*”/g, "")
    .replace(/^\s*>.*$/gm, "");

  if (/\b(?:stop|cancel|do not|don['’]t|never|non|smetti|evita|annulla|fermati)\b/i.test(request))
    return [];
  const ids = request
    .split(/[.!?\n]+/)
    .map((sentence) =>
      /^(?:use|reserve|usa|riserva)\s+(?:the\s+|lo\s+)?(?:space|spazio)\s+id\s+([1-9]\d*)\s+(?:for\s+(?:this|the)\s+task|per\s+(?:questo\s+task|questa\s+attività))\s*$/i.exec(
        sentence.trim(),
      ),
    )
    .flatMap((match) => {
      const id = match ? Number(match[1]) : NaN;
      return Number.isSafeInteger(id) && id > 0 ? [id] : [];
    });
  return [...new Set(ids)].slice(0, 64);
}

export function computerSpaceDesignationForMessages(
  messages: readonly OrchestrationMessage[],
): readonly number[] {
  const latest = latestUserAuthoredMessage(messages);

  const latestUserRole = messages.findLast((message) => message.role === "user");
  return latest && latest === latestUserRole ? messageDesignatesComputerSpaces(latest.text) : [];
}
