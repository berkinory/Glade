import { createLogger } from "../../diagnostics/logger";
import type { AcpConnection } from "./acpConnection";

const log = createLogger("acp-shutdown");

export async function closeAcpSession(
  connection: AcpConnection,
  sessionId: string,
  deleteHistory = false,
): Promise<void> {
  const capabilities = connection.initialize.agentCapabilities?.sessionCapabilities;
  if (!capabilities?.close && !(deleteHistory && capabilities?.delete)) {
    await connection.close();
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deleteHistory && capabilities?.delete
        ? connection.agent.deleteSession({ sessionId })
        : connection.agent.closeSession({ sessionId }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for session/close.")), 5_000);
        timer.unref();
      }),
    ]);
  } catch (cause) {
    log.warn("ACP session close was not confirmed; stopping its process", { sessionId, cause });
    await connection.close(
      new Error("A chat could not stop safely; its shared agent process must restart.", { cause }),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
