import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  PROVIDER_AUTHENTICATION_PATH,
  ProviderAuthenticationStatus,
  type ProviderAuthenticationRequest,
} from "@glade/contracts/provider/providerAuthentication";
import { PROVIDER_DISPLAY_NAMES } from "@glade/contracts/provider/model";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
import { providerDiscoveryQueryKeys } from "~/lib/providerDiscoveryReactQuery";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import {
  getTerminalFontFamily,
  getTerminalFontSizePx,
  terminalThemeFromApp,
} from "../terminal/terminalRuntimeAppearance";
import { Button } from "../ui/button";
import "@xterm/xterm/css/xterm.css";

type Provider = ProviderAuthenticationRequest["provider"];
async function request(
  input: ProviderAuthenticationRequest,
): Promise<ProviderAuthenticationStatus | null> {
  const response = await fetch(resolveWsHttpUrl(PROVIDER_AUTHENTICATION_PATH), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Sign-in is unavailable.";
    throw new Error(message);
  }
  return Schema.decodeUnknownSync(Schema.NullOr(ProviderAuthenticationStatus))(body);
}

export function ProviderSignIn({
  provider,
  authenticated,
}: {
  provider: Provider;
  authenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ProviderAuthenticationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const live = useRef(view);
  const written = useRef({ id: "", offset: 0 });
  const refreshed = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const refresh = useRefreshProviderStatusesNow();
  useEffect(() => {
    live.current = view;
  }, [view]);
  const showError = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : "Sign-in is unavailable.");

  useEffect(() => {
    if (!open || !host.current) return;
    const instance = new Terminal({
      fontSize: getTerminalFontSizePx(),
      fontFamily: getTerminalFontFamily(),
      theme: terminalThemeFromApp(),
      scrollback: 1000,
      screenReaderMode: true,
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(host.current);
    fit.fit();
    terminal.current = instance;
    written.current = { id: "", offset: 0 };
    const input = instance.onData((data) => {
      const current = live.current;
      if (current?.status === "running")
        void request({ provider, action: "write", id: current.id, data }).catch(showError);
    });
    const resize = instance.onResize(({ cols, rows }) => {
      const current = live.current;
      if (current?.status === "running")
        void request({
          provider,
          action: "resize",
          id: current.id,
          cols: Math.max(10, Math.min(300, cols)),
          rows: Math.max(5, Math.min(100, rows)),
        }).catch(showError);
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      input.dispose();
      resize.dispose();
      instance.dispose();
      terminal.current = null;
    };
  }, [open, provider]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await request({ provider, action: "status" });
        if (!disposed) {
          setView(next);
          setError(null);
        }
      } catch (cause) {
        if (!disposed) showError(cause);
      }
      if (!disposed) timer = setTimeout(() => void poll(), 750);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [open, provider]);

  useEffect(() => {
    const instance = terminal.current;
    if (!instance || !view) return;
    const previous = written.current;
    if (previous.id !== view.id || previous.offset < view.outputOffset) {
      instance.reset();
      instance.write(view.output);
    } else instance.write(view.output.slice(previous.offset - view.outputOffset));
    written.current = { id: view.id, offset: view.outputOffset + view.output.length };
  }, [view]);

  const verify = useEffectEvent(async (id: string) => {
    try {
      const statuses = await refresh({ silent: true });
      await queryClient.invalidateQueries({ queryKey: providerDiscoveryQueryKeys.modelsAll });
      if (live.current?.id === id)
        setVerification(
          statuses?.find((entry) => entry.provider === provider)?.authStatus === "authenticated"
            ? "Sign-in verified."
            : "Sign-in has not been verified. Check provider status before continuing.",
        );
    } catch {
      if (live.current?.id === id)
        setVerification("Could not verify sign-in. Refresh provider status.");
    }
  });
  useEffect(() => {
    if (view?.status !== "exited" || refreshed.current === view.id) return;
    refreshed.current = view.id;
    void verify(view.id);
  }, [view?.id, view?.status]);

  async function start() {
    setBusy(true);
    setError(null);
    setVerification(null);
    try {
      setView(await request({ provider, action: "start" }));
      setOpen(true);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    setBusy(true);
    try {
      const current = live.current;
      if (current) await request({ provider, action: "close", id: current.id });
      setOpen(false);
      setView(null);
      setError(null);
    } catch (cause) {
      showError(cause);
    } finally {
      setBusy(false);
    }
  }
  if (authenticated && !open) return null;

  return (
    <div className="space-y-2 px-3 pb-3">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void (open ? close() : start())}
      >
        {open ? "Close sign-in" : `Sign in to ${PROVIDER_DISPLAY_NAMES[provider]}`}
      </Button>
      {error ? (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      ) : null}
      {open ? (
        <>
          <p className="text-ui-sm text-muted-foreground">
            {view?.executable} · {view?.home}
          </p>
          <div
            ref={host}
            aria-label={`${PROVIDER_DISPLAY_NAMES[provider]} sign-in terminal`}
            className="h-72 overflow-hidden rounded-lg border bg-background p-2"
          />
          <p role="status" className="text-ui-sm text-muted-foreground">
            {view?.status === "exited"
              ? `Command exited (${view.exitCode}). ${verification ?? "Checking sign-in…"}`
              : "Complete sign-in in the provider terminal. Closing this panel stops the command."}
          </p>
        </>
      ) : null}
    </div>
  );
}
