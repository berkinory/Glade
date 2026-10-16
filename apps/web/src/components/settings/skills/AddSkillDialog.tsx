import type {
  SkillPreview,
  SkillsDirectoryEntry,
} from "@glade/contracts/transport/ws/skillsDirectoryRpc";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useDeferredValue, useState } from "react";

import { AlertCircleIcon, ArrowRight02Icon, DownloadIcon, SearchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { SearchInput } from "../../ui/search-input";
import { Skeleton } from "../../ui/skeleton";
import { Spinner } from "../../ui/spinner";
import { SkillPreviewStep } from "./SkillPreviewStep";

const installsFormat = new Intl.NumberFormat("en", { notation: "compact" });

// A pasted skills.sh or GitHub link, or an `owner/repo` id, is opened directly instead of searched.
const isReference = (value: string) =>
  /^https?:\/\//u.test(value) || /^[\w.-]+\/[\w.-]+/u.test(value);

const ROW_CLASS_NAME =
  "flex h-13 w-full min-w-0 items-center gap-3 rounded-lg px-2.5 text-left outline-none hover:bg-[var(--color-background-elevated-secondary)] focus-visible:ring-1 focus-visible:ring-ring/60 disabled:pointer-events-none";

function Notice(props: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center text-ui-sm text-muted-foreground [&>svg]:size-5">
      {props.icon}
      {props.children}
    </div>
  );
}

function SearchStep(props: {
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  readonly picking: string | null;
  readonly error: string | null;
  readonly onPick: (reference: string) => void;
}) {
  const typed = props.search.trim();
  const query = useDeferredValue(typed);
  const reference = isReference(typed);
  const results = useQuery({
    queryKey: ["skills-directory", "search", query],
    queryFn: () => ensureNativeApi().skillsDirectory.search({ query }),
    enabled: query.length >= 2 && !isReference(query),
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const row = (key: string, reference: string, content: ReactNode, trailing: ReactNode) => (
    <button
      key={key}
      type="button"
      disabled={props.picking !== null}
      onClick={() => props.onPick(reference)}
      className={cn(
        ROW_CLASS_NAME,
        props.picking !== null && props.picking !== reference && "opacity-50",
      )}
    >
      <span className="min-w-0 flex-1">{content}</span>
      <span className="flex shrink-0 items-center gap-1 text-ui-xs text-muted-foreground">
        {props.picking === reference ? <Spinner className="size-4" /> : trailing}
      </span>
    </button>
  );

  const entryRow = (entry: SkillsDirectoryEntry) =>
    row(
      `${entry.repository}/${entry.skillId}`,
      `${entry.repository}/${entry.skillId}`,
      <>
        <span className="block truncate text-ui font-medium text-foreground">{entry.name}</span>
        <span className="block truncate text-ui-sm text-muted-foreground">{entry.repository}</span>
      </>,
      <span className="flex items-center gap-1" title={`${entry.installs} installs`}>
        <DownloadIcon aria-hidden className="size-3.5" />
        {installsFormat.format(entry.installs)}
      </span>,
    );

  let body: ReactNode;
  if (reference) {
    body = row(
      "reference",
      typed,
      <>
        <span className="block truncate text-ui font-medium text-foreground">Open link</span>
        <span className="block truncate text-ui-sm text-muted-foreground">{typed}</span>
      </>,
      <ArrowRight02Icon aria-hidden className="size-4" />,
    );
  } else if (query.length < 2) {
    body = (
      <Notice icon={<SearchIcon aria-hidden />}>
        Search the skills on skills.sh, or paste a skills.sh or GitHub link.
      </Notice>
    );
  } else if (results.isError) {
    body = (
      <Notice icon={<AlertCircleIcon aria-hidden className="text-destructive" />}>
        {results.error instanceof Error
          ? results.error.message
          : "skills.sh could not be searched."}{" "}
        A pasted link still works.
      </Notice>
    );
  } else if (!results.data) {
    body = Array.from({ length: 6 }, (_, index) => (
      <div key={index} className="flex h-13 items-center gap-3 px-2.5">
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-3 w-10" />
      </div>
    ));
  } else if (results.data.skills.length === 0) {
    body = <Notice icon={<SearchIcon aria-hidden />}>No skills match “{query}”.</Notice>;
  } else {
    body = (
      <div className={cn("flex flex-col gap-0.5", results.isPlaceholderData && "opacity-60")}>
        {results.data.skills.map(entryRow)}
      </div>
    );
  }

  return (
    <>
      <DialogHeader className="px-5 pt-5">
        <DialogTitle>Add a skill</DialogTitle>
        <DialogDescription>Install a skill from skills.sh or GitHub.</DialogDescription>
        <div className="mt-2">
          <SearchInput
            value={props.search}
            autoFocus
            onChange={(event) => props.onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && reference && props.picking === null) props.onPick(typed);
            }}
            placeholder="Search skills or paste a link"
            aria-label="Search skills or paste a link"
          />
        </div>
        {props.error ? (
          <p role="alert" className="flex items-start gap-1.5 pt-1 text-ui-sm text-destructive">
            <AlertCircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {props.error}
          </p>
        ) : null}
      </DialogHeader>
      <DialogPanel className="px-3">{body}</DialogPanel>
    </>
  );
}

function AddSkillFlow(props: {
  readonly onClose: () => void;
  readonly onInstalled: (name: string, paths: ReadonlyArray<string>) => void;
}) {
  // Kept here so going back from a preview returns to the same results.
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (reference: string) => {
    setPicking(reference);
    setError(null);
    ensureNativeApi()
      .skillsDirectory.preview({ reference })
      .then(setPreview)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Glade could not read that skill."),
      )
      .finally(() => setPicking(null));
  };

  return (
    <div
      key={preview ? "preview" : "search"}
      className="chat-pane-enter flex min-h-0 flex-1 flex-col"
    >
      {preview ? (
        <SkillPreviewStep
          preview={preview}
          onBack={() => setPreview(null)}
          onInstalled={(paths) => props.onInstalled(preview.name, paths)}
        />
      ) : (
        <>
          <SearchStep
            search={search}
            onSearchChange={setSearch}
            picking={picking}
            error={error}
            onPick={pick}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
          </DialogFooter>
        </>
      )}
    </div>
  );
}

export function AddSkillDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onInstalled: (name: string, paths: ReadonlyArray<string>) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* One fixed height for every step, so searching and previewing never resize the dialog. */}
      <DialogPopup className="h-[min(38rem,calc(100dvh-6rem))] max-w-lg">
        {props.open ? (
          <AddSkillFlow
            onClose={() => props.onOpenChange(false)}
            onInstalled={(name, paths) => {
              props.onOpenChange(false);
              props.onInstalled(name, paths);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}
