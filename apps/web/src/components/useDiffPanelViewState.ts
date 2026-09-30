import * as Schema from "effect/Schema";
import { useCallback, useState } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";

const DiffRenderModeSchema = Schema.Literals(["stacked", "split"]);

export function useDiffPanelViewState(initialWordWrap: boolean) {
  const [diffRenderMode, setDiffRenderMode] = useLocalStorage(
    "glade:diff-render-mode:v1",
    "split",
    DiffRenderModeSchema,
  );
  const [diffWordWrap, setDiffWordWrap] = useState(initialWordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(true);
  const [changeMarkersEnabled, setChangeMarkersEnabled] = useState(true);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const handleScopePickerOpenChange = useCallback((open: boolean) => {
    setScopePickerOpen((previous) => (previous === open ? previous : open));
  }, []);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [fileTreeOpen, setFileTreeOpen] = useState(false);

  const [fileTreeMounted, setFileTreeMounted] = useState(false);
  const toggleFileTree = useCallback(() => {
    setFileTreeOpen((previous) => !previous);
    setFileTreeMounted(true);
  }, []);
  const closeFileTree = useCallback(() => {
    setFileTreeOpen(false);
  }, []);
  return {
    diffRenderMode,
    setDiffRenderMode,
    diffWordWrap,
    setDiffWordWrap,
    diffIgnoreWhitespace,
    setDiffIgnoreWhitespace,
    changeMarkersEnabled,
    setChangeMarkersEnabled,
    scopePickerOpen,
    setScopePickerOpen,
    handleScopePickerOpenChange,
    collapsedFiles,
    setCollapsedFiles,
    fileTreeOpen,
    setFileTreeOpen,
    fileTreeMounted,
    toggleFileTree,
    closeFileTree,
  };
}
