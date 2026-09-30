import type { OrchestrationMessage } from "@glade/contracts/orchestration/threadEntities";

// The never-raise default is the containment the Helium incident demanded: a task that said "use
// Helium" was never asked to *show* Helium, yet the run raised it, then ran twenty-one foreground
// excursions through it while the user was typing. Explicit consent survives a chain of routine
// continuations; a new task, stop, background request, imported history or nonhuman dispatch ends
// it.
export interface ComputerForegroundAuthorization {
  readonly userRequestedVisibleUse: boolean;
}

export interface ComputerForegroundContext {
  readonly knownAppNames?: readonly string[];
}

export const COMPUTER_FOREGROUND_NOT_AUTHORIZED: ComputerForegroundAuthorization = {
  userRequestedVisibleUse: false,
};

export const COMPUTER_FOREGROUND_NOT_REQUESTED_CODE = "foreground_not_requested";

export const COMPUTER_FOREGROUND_USER_INTERACTION_CODE = "foreground_user_interaction";

export const COMPUTER_USER_INTERACTION_QUIET_MS = 2_000;

const APOSTROPHE = "['’]";

const CLAUSE_END = String.raw`(?=\s*(?:[.!?,;:]|$))`;
const WHAT_YOU_ARE_DOING = `what you(?:${APOSTROPHE}re| are) doing`;
const WHAT_IS_HAPPENING = `what(?:${APOSTROPHE}s| is) (?:going on|happening)${CLAUSE_END}`;
const WANT_TO = `i (?:want|would like|${APOSTROPHE}d like) to`;
const SO_WE_CAN = "so (?:that )?(?:i|we) can (?:all )?";

const VISIBLE_USE_PATTERNS: readonly RegExp[] = [
  /\bshow (?:me )?(?:the |my )?(?:[\w-]+ ){0,3}(?:window|app|screen|desktop|browser|page)(?=\s*(?:[.!?,;:]|$))/i,
  new RegExp(
    String.raw`\b(?:show me|let me see|${WANT_TO} see|${SO_WE_CAN}see) (?:${WHAT_YOU_ARE_DOING}\b|${WHAT_IS_HAPPENING})`,
    "i",
  ),
  new RegExp(
    String.raw`\b(?:${WANT_TO} |let me )watch (?:you|it|the (?:app|browser|window))\b|\b${SO_WE_CAN}watch(?: (?:you|along))?${CLAUSE_END}`,
    "i",
  ),
  /\blet me see (?:it|you) work(?:ing)?\b/i,
  /\bi (?:want|would like|['’]d like) to see (?:the |my )?(?:[\w-]+ ){0,3}(?:window|app|screen|desktop|browser|page)(?=\s*(?:[.!?,;:]|$))/i,
  /\b(?:put|show|display)\b[^.!?\n]{0,40}\bon (?:my|the) screen\b/i,
  /\b(?:make|keep) (?:it|(?:the |my )?(?:[\w-]+ ){0,3}(?:app|window|browser)) visible\b/i,
  // A generic thing brought "to the front" is not necessarily an app. The target must be a screen
  // object, a known app (below), or an explicit wish to watch. Unrecognized names get the consent
  // card instead of a silent raise.
  /\b(?:bring|put|move|pull|raise)\s+(?:(?:the|my|this|that)\s+)?(?:window|app|browser|screen|desktop|it)\s+(?:to\s+(?:the\s+)?front\b(?!\s+(?:of|desk|door|row|page)\b)|(?:to|in|into)\s+(?:the\s+)?foreground\b)/i,
  /\b(?:bring|put|move|pull|raise)\b[^.!?\n]{0,40}\b(?:to\s+(?:the\s+)?front|(?:to|in|into)\s+(?:the\s+)?foreground)\b(?=\s+(?:so\s+(?:that\s+)?(?:i|we)\s+can\s+(?:all\s+)?(?:watch|see)\b|and\s+show\s+me\b))/i,

  /\b(?:bring|pull)(?: up)? (?:the |my |its |their )?(?:[\w-]+ ){0,2}(?:window|app|browser) (?:forward|up front)\b/i,
  /\buse (?:the )?foreground(?: mode)?(?=\s*(?:[.!?,;:]|$))/i,
  /\btake over (?:my|the) (?:screen|desktop|computer)\b/i,
  /\bdrive (?:my|the) (?:screen|desktop|computer)\b/i,
  /\b(?:mostra(?:mi|re)?|porta(?:re)?|metti|mettere)\b[^.!?\n]{0,60}\b(?:sullo schermo|in primo piano)\b/i,
  /\b(?:voglio|vorrei|fammi) vedere (?:la finestra|il browser|lo schermo|il desktop|cosa (?:fai|stai facendo))\b/i,
];

const BACKGROUND_USE_PATTERNS: readonly RegExp[] = [
  /\b(?:do not|don['’]t|never|not|avoid|without|stop)\b[^.!?\n]{0,100}\b(?:show|watch|visible|foreground|front|focus|raise|screen|desktop)\b/i,
  /\b(?:keep|stay|remain|work|run|use)\b[^.!?\n]{0,60}\b(?:background|hidden|invisible)\b/i,
  /\bbackground[- ]only\b/i,
  /\b(?:non|senza|evita|smetti di)\b[^.!?\n]{0,100}\b(?:mostrare|mostrarmi|primo piano|schermo|focus)\b/i,
  /\b(?:lavora|resta|rimani|mantieni)\b[^.!?\n]{0,60}\b(?:background|nascost[ao])\b/i,
];

function unquotedRequest(text: string): string {
  return text
    .replace(/<untrusted_text\b[^>]*>[\s\S]*?(?:<\/untrusted_text>|$)/gi, "")
    .replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/g, "")
    .replace(/(^|[\s(])'[^'\n]+'(?=$|[\s.,;:)])/g, "$1")
    .replace(/^\s*>.*$/gm, "");
}

function requestsKnownAppVisibility(text: string, context: ComputerForegroundContext): boolean {
  const app = text
    .trim()
    .match(/^(?:please[, ]+)?(?:show(?: me)?|display|mostra(?:mi)?)\s+(.+?)[.!?]*$/iu)?.[1];
  if (!app) return false;
  const name = app.trim().toLocaleLowerCase();
  return (
    context.knownAppNames?.some((candidate) => candidate.trim().toLocaleLowerCase() === name) ===
    true
  );
}

function requestsKnownAppForeground(text: string, context: ComputerForegroundContext): boolean {
  const app = text
    .trim()
    .match(
      /^(?:please[, ]+)?(?:bring|put|move|pull|raise)\s+(.+?)\s+(?:to\s+(?:the\s+)?front|(?:to|in|into)\s+(?:the\s+)?foreground)[.!?]*$/iu,
    )?.[1];
  if (!app) return false;
  const name = app.trim().toLocaleLowerCase();
  return (
    context.knownAppNames?.some((candidate) => candidate.trim().toLocaleLowerCase() === name) ===
    true
  );
}

function messageRequestsVisibleUse(text: string, context: ComputerForegroundContext = {}): boolean {
  const request = unquotedRequest(text);
  return (
    !BACKGROUND_USE_PATTERNS.some((pattern) => pattern.test(request)) &&
    (VISIBLE_USE_PATTERNS.some((pattern) => pattern.test(request)) ||
      requestsKnownAppVisibility(request, context) ||
      requestsKnownAppForeground(request, context))
  );
}

function isAffirmativeReply(text: string): boolean {
  return /^(?:yes|yeah|yep|ok(?:ay)?|sure|go ahead|s[iì]|va bene|certo|procedi|vai)(?:[, ]+(?:please|go ahead|per favore|fallo))?[.!]*$/iu.test(
    text.trim(),
  );
}

function asksVisibleUsePermission(text: string, context: ComputerForegroundContext): boolean {
  const question = unquotedRequest(text).trim();

  const action = question.match(
    /(?:^|[.!?]\s+)(?:can i|may i|shall i|do you want me to|would you like me to|is it (?:ok(?:ay)?|alright) (?:if i|to)|posso|vuoi che)\s+([^?]*\?)$/iu,
  )?.[1];
  return action !== undefined && messageRequestsVisibleUse(action, context);
}

function isLocalHumanMessage(message: OrchestrationMessage): boolean {
  return (
    message.role === "user" &&
    message.dispatchOrigin !== "automation" &&
    message.dispatchOrigin !== "agent" &&
    (message.source === "native" || message.source === "async-user-input")
  );
}

function isLocalAssistantMessage(
  message: OrchestrationMessage | undefined,
): message is OrchestrationMessage {
  return message?.role === "assistant" && message.source === "native" && !message.streaming;
}

function confirmsVisibleUse(
  reply: OrchestrationMessage,
  preceding: OrchestrationMessage | undefined,
  context: ComputerForegroundContext,
): boolean {
  return (
    isLocalAssistantMessage(preceding) &&
    isAffirmativeReply(reply.text) &&
    asksVisibleUsePermission(preceding.text, context)
  );
}

function confirmsStructuredVisibleUse(
  messages: readonly OrchestrationMessage[],
  replyIndex: number,
  context: ComputerForegroundContext,
): boolean {
  const reply = messages[replyIndex]!;
  for (let index = replyIndex - 1; index >= 0; index -= 1) {
    const question = messages[index]!;
    // Answering a stale card from an earlier user task must not grant the new task visibility.
    if (question.role === "user") return false;
    const input = question.asyncUserInput;
    if (input?.response?.messageId !== reply.id) continue;
    return (
      isLocalAssistantMessage(question) &&
      input.questions.length === 1 &&
      input.response.answers.length === 1 &&
      isAffirmativeReply(input.response.answers[0]!) &&
      asksVisibleUsePermission(input.questions[0]!.title, context)
    );
  }
  return false;
}

function isRoutineContinuation(message: OrchestrationMessage): boolean {
  if (message.attachments?.length || message.skills?.length || message.mentions?.length)
    return false;
  return /^(?:(?:ok(?:ay)?|yes|s[iì])[, ]+)?(?:please[, ]+)?(?:continue(?: (?:working|with (?:the |this |our )?(?:same |current )?(?:task|work|plan)))?|keep (?:going|working)|carry on|go (?:on|ahead)|proceed(?: with (?:the |this |our )?(?:same |current )?(?:task|work|plan))?|(?:try|retry)(?: (?:again|that|it|the same step))?|continua(?: pure)?|prosegui|procedi|vai|riprova)(?:[, ]+(?:please|per favore))?[.!]*$/iu.test(
    message.text.trim(),
  );
}

export function latestUserAuthoredMessage(
  messages: readonly OrchestrationMessage[],
): OrchestrationMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    if (message.dispatchOrigin === "automation" || message.dispatchOrigin === "agent") continue;
    return message;
  }
  return undefined;
}

export function computerForegroundScopeChangedSince(
  messages: readonly OrchestrationMessage[],
  lastMessageId: string | undefined,
): boolean {
  const start =
    lastMessageId === undefined
      ? -1
      : messages.findIndex((message) => message.id === lastMessageId);
  if (lastMessageId !== undefined && start === -1) return true;
  return messages
    .slice(start + 1)
    .some(
      (message) =>
        message.role === "user" &&
        (!isLocalHumanMessage(message) || !isRoutineContinuation(message)),
    );
}

// Routine continuations preserve an explicit grant; they cannot create one. A new task, refusal or
// nonhuman/imported turn is a barrier, so a later "continue" cannot recover consent from an
// unrelated historical task.
export function computerForegroundAuthorizationForMessages(
  messages: readonly OrchestrationMessage[],
  context: ComputerForegroundContext = {},
): ComputerForegroundAuthorization {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    if (!isLocalHumanMessage(message)) return COMPUTER_FOREGROUND_NOT_AUTHORIZED;
    if (message.source === "async-user-input") {
      return { userRequestedVisibleUse: confirmsStructuredVisibleUse(messages, index, context) };
    }
    if (
      messageRequestsVisibleUse(message.text, context) ||
      confirmsVisibleUse(message, messages[index - 1], context)
    ) {
      return { userRequestedVisibleUse: true };
    }
    if (!isRoutineContinuation(message)) return COMPUTER_FOREGROUND_NOT_AUTHORIZED;
  }
  return COMPUTER_FOREGROUND_NOT_AUTHORIZED;
}
