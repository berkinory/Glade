import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";

import { APP_VERSION } from "../branding";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { WHATS_NEW_ENTRIES } from "./entries";
import {
  resolveWhatsNewState,
  type WhatsNewEntry,
  type WhatsNewInputs,
  type WhatsNewState,
} from "./logic";

const WHATS_NEW_STORAGE_KEY = "glade:whats-new:v1";

const WhatsNewStorageSchema = Schema.Struct({
  lastSeenVersion: Schema.NullOr(Schema.String),
});
type WhatsNewStorage = typeof WhatsNewStorageSchema.Type;

const INITIAL_STORAGE: WhatsNewStorage = { lastSeenVersion: null };

export interface UseWhatsNewResult {
  readonly currentEntry: WhatsNewEntry | null;

  readonly allEntries: readonly WhatsNewEntry[];

  readonly currentVersion: string;

  readonly isPopoutVisible: boolean;

  readonly isDialogOpen: boolean;

  readonly openDialog: () => void;

  readonly dismissPopout: () => void;

  readonly onDialogOpenChange: (open: boolean) => void;
}

export function useWhatsNew(options?: {
  readonly entries?: readonly WhatsNewEntry[];
  readonly currentVersion?: string;
}): UseWhatsNewResult {
  const entries = options?.entries ?? WHATS_NEW_ENTRIES;
  const currentVersion = options?.currentVersion ?? APP_VERSION;

  const [storage, setStorage] = useLocalStorage(
    WHATS_NEW_STORAGE_KEY,
    INITIAL_STORAGE,
    WhatsNewStorageSchema,
  );

  const [initialLastSeenVersion] = useState(() => storage.lastSeenVersion);
  const initialState: WhatsNewState = resolveWhatsNewState({
    entries,
    currentVersion,
    lastSeenVersion: initialLastSeenVersion,
  } satisfies WhatsNewInputs);

  const [isPopoutVisible, setIsPopoutVisible] = useState(initialState.kind === "show");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Silent bootstrap (first launch or no curated notes for this upgrade): advance the marker in the
  // background so the next upgrade is correctly detected. Done in an effect so we only touch storage
  // once per mount. Once-per-mount by design (ref-guarded): the storage write must not depend on the
  // referential identity of initialState/setStorage, which are not guaranteed stable — an
  // identity-driven re-run would loop setStorage.
  const silentBootstrapDoneRef = useRef(false);
  useEffect(() => {
    if (silentBootstrapDoneRef.current || initialState.kind !== "silent-bootstrap") {
      return;
    }
    silentBootstrapDoneRef.current = true;
    setStorage({ lastSeenVersion: initialState.nextLastSeenVersion });
  }, [initialState, setStorage]);

  const currentEntry: WhatsNewEntry | null =
    initialState.kind === "show" ? initialState.currentEntry : null;

  const allEntries: readonly WhatsNewEntry[] =
    initialState.kind === "show" ? initialState.allEntries : [];

  const markSeen = () => {
    if (initialState.kind === "show") {
      setStorage({ lastSeenVersion: initialState.nextLastSeenVersion });
    }
  };

  const openDialog = () => {
    setIsDialogOpen(true);
  };

  const dismissPopout = () => {
    setIsPopoutVisible(false);
    markSeen();
  };

  const onDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setIsPopoutVisible(false);
      markSeen();
    }
  };

  return {
    currentEntry,
    allEntries,
    currentVersion,
    isPopoutVisible,
    isDialogOpen,
    openDialog,
    dismissPopout,
    onDialogOpenChange,
  };
}
