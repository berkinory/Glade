import { CheckIcon, Copy01Icon, FolderIcon } from "~/lib/icons";
import { IconButton } from "~/components/ui/icon-button";
import { useCopyToClipboard } from "~/lib/clipboard";

export function EnvironmentDirectoryPath({
  path,
  displayPath,
}: {
  path: string | null;
  displayPath: string;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();

  return (
    <div className="flex min-w-0 items-center gap-1">
      <FolderIcon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <code className="block w-max whitespace-nowrap text-ui-sm" title={path ?? undefined}>
          {displayPath}
        </code>
      </div>
      <IconButton
        label={isCopied ? "Working directory copied" : "Copy working directory"}
        tooltip={isCopied ? "Copied" : "Copy full path"}
        className="size-5 shrink-0"
        disabled={!path}
        onClick={() => {
          if (path) copyToClipboard(path, undefined);
        }}
      >
        {isCopied ? (
          <CheckIcon className="size-3 text-success" />
        ) : (
          <Copy01Icon className="size-3" />
        )}
      </IconButton>
    </div>
  );
}
