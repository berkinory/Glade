import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resolveAndPersistPreferredEditor } from "~/editorPreferences";
import { FolderIcon } from "~/lib/icons";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./SettingsPanelPrimitives";

function ConfigFileRow(props: {
  id: string;
  title: string;
  description: string;
  path: string | null;
}) {
  const availableEditors = useQuery(serverConfigQueryOptions()).data?.availableEditors;
  const [isOpening, setIsOpening] = useState(false);
  const open = () => {
    if (!props.path) return;
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
    if (!editor) {
      toastManager.add({ type: "error", title: "No editor available" });
      return;
    }
    setIsOpening(true);
    void ensureNativeApi()
      .shell.openInEditor(props.path, editor)
      .catch((error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not open file",
          description: `Could not open ${props.title.toLowerCase()}. ${error instanceof Error ? error.message : String(error)}`,
        }),
      )
      .finally(() => setIsOpening(false));
  };
  return (
    <SettingsRow
      id={props.id}
      title={props.title}
      description={props.description}
      status={
        <span className="block break-all font-mono text-ui-sm">{props.path ?? "Resolving…"}</span>
      }
      control={
        <Button size="sm" variant="outline" disabled={!props.path || isOpening} onClick={open}>
          <FolderIcon />
          Open file
        </Button>
      }
    />
  );
}

export function ConfigFileRows() {
  const config = useQuery(serverConfigQueryOptions()).data;
  return (
    <>
      <ConfigFileRow
        id="setting-settings-file"
        title="Settings file"
        description="Edit server settings directly. Saved changes apply right away."
        path={config?.settingsPath ?? null}
      />
      <ConfigFileRow
        id="setting-shortcuts-file"
        title="Shortcuts file"
        description="Edit keyboard shortcuts and their conditions directly."
        path={config?.keybindingsConfigPath ?? null}
      />
    </>
  );
}
