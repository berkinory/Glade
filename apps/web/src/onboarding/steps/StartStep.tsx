import type { ProjectId } from "@glade/contracts/core/baseSchemas";
import { useEffect, useState, type FormEvent } from "react";
import { useAppSettings } from "~/appSettings";
import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { isElectron } from "~/env";
import { useWindowFolderDrop } from "~/hooks/useWindowFolderDrop";
import { CheckIcon, ChevronRightIcon, FolderIcon, FolderPlusIcon } from "~/lib/icons";
import { createOrRecoverProjectFromPath } from "~/lib/projectCreation";
import { expandProjectHomePath } from "~/lib/projectPaths";
import { cn } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import { resolveFallbackProvider } from "~/providerOrdering";
import { SETTINGS_NAV_ITEMS, type SettingsSectionId } from "~/settingsNavigation";
import { useStore } from "~/store";
import { useWorkspacePathsStore } from "~/workspacePathsStore";

export interface OnboardingProjectResult {
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly created: boolean;
}

const LATER_SECTIONS: ReadonlySet<SettingsSectionId> = new Set(["mcp", "skills", "ssh", "remote"]);

function tildePath(path: string, homeDir: string | null): string {
  return homeDir && path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path;
}

function ProjectPicker(props: {
  onResult: (result: OnboardingProjectResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { settings } = useAppSettings();
  const homeDir = useWorkspacePathsStore((store) => store.homeDir);
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { onBusyChange } = props;
  const busy = picking || submitting;
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const addProject = async (rawPath: string) => {
    const api = readNativeApi();
    const workspaceRoot = expandProjectHomePath(rawPath.trim(), homeDir);
    if (!api || workspaceRoot.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createOrRecoverProjectFromPath({
        api,
        workspaceRoot,
        spaceId: null,
        defaultProvider: resolveFallbackProvider(settings),
        loadSnapshot: () => api.orchestration.getShellSnapshot().catch(() => null),
      });
      if (result.snapshot) syncServerShellSnapshot(result.snapshot);
      props.onResult({
        projectId: result.projectId,
        workspaceRoot: result.project?.workspaceRoot ?? workspaceRoot,
        created: result.created,
      });
      setPath("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the project.");
    } finally {
      setSubmitting(false);
    }
  };
  const browse = async () => {
    const api = readNativeApi();
    if (!api) return;
    setPicking(true);
    try {
      const picked = await api.dialogs.pickFolder();
      if (picked) await addProject(picked);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the folder picker.");
    } finally {
      setPicking(false);
    }
  };
  const isDropTarget = useWindowFolderDrop({
    enabled: isElectron && !busy,
    onFolder: (dropped) => void addProject(dropped),
    onError: setError,
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void addProject(path);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {isElectron ? (
        <button
          type="button"
          disabled={busy}
          className={cn(
            "flex h-[104px] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/18 text-ui text-foreground/85 transition-colors outline-none hover:bg-foreground/3 focus-visible:border-foreground/40 disabled:opacity-50 motion-reduce:transition-none",
            isDropTarget && "border-solid border-[color:var(--color-border-focus)] bg-foreground/5",
          )}
          onClick={() => void browse()}
        >
          <FolderPlusIcon className="size-5 text-foreground/70" aria-hidden />
          {picking ? (
            "Opening the folder picker…"
          ) : (
            <span>
              Drop a folder here, or{" "}
              <span className="underline decoration-dotted decoration-[1.5px] underline-offset-[5px]">
                browse
              </span>
            </span>
          )}
        </button>
      ) : null}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <InputGroup className="h-9 min-w-0 flex-1 rounded-lg border-foreground/12">
          <InputGroupAddon className="w-10 self-stretch border-e border-foreground/12 ps-0">
            <FolderIcon className="size-4 text-muted-foreground/70" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setError(null);
            }}
            placeholder={homeDir ? `${homeDir}/code/my-repo` : "/path/to/repository"}
            aria-label="Project folder path"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            disabled={submitting}
          />
        </InputGroup>
        <Button
          type="submit"
          variant="outline"
          className="h-9 shrink-0 rounded-lg border-foreground/12 px-4"
          disabled={submitting || path.trim().length === 0}
        >
          Add
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-ui text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StartStep(props: {
  results: ReadonlyArray<OnboardingProjectResult>;
  onResult: (result: OnboardingProjectResult) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenSettings: (section: SettingsSectionId) => void;
}) {
  const homeDir = useWorkspacePathsStore((store) => store.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((store) => store.chatWorkspaceRoot);
  const laterItems = SETTINGS_NAV_ITEMS.filter(
    (item) => LATER_SECTIONS.has(item.id) && (isElectron || !item.desktopOnly),
  );
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2.5">
        {props.results.length > 0 ? (
          <ul className="flex flex-col gap-1.5" aria-label="Added projects">
            {props.results.map((result) => (
              <li
                key={result.projectId}
                className="flex h-10 items-center gap-3 rounded-lg bg-foreground/4 px-3.5"
              >
                <FolderIcon className="size-[15px] shrink-0 text-foreground/70" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground">
                  {tildePath(result.workspaceRoot, homeDir)}
                </span>
                <span className="flex items-center gap-1.5 text-ui-sm text-success">
                  <CheckIcon className="size-3" aria-hidden />
                  {result.created ? "Added" : "Already added"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ProjectPicker onResult={props.onResult} onBusyChange={props.onBusyChange} />
        <p className="text-ui-sm text-muted-foreground">
          No project? Chats work without one, in{" "}
          <code className="text-foreground/80">
            {chatWorkspaceRoot ? tildePath(chatWorkspaceRoot, homeDir) : "your chat folder"}
          </code>
          .
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-ui-sm font-medium text-muted-foreground">When you need them</h3>
        <ul className="grid grid-cols-2 gap-1.5">
          {laterItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="group flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-foreground/7 px-3 py-2.5 text-start outline-none transition-colors hover:bg-foreground/3 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none"
                  onClick={() => props.onOpenSettings(item.id)}
                >
                  <Icon className="size-4 shrink-0 text-foreground/70" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ui text-foreground">
                    {item.label}
                  </span>
                  <ChevronRightIcon
                    className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground motion-reduce:transition-none"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
