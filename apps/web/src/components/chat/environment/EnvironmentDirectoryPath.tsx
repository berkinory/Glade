import { CheckIcon, Copy01Icon } from "~/lib/icons";
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
      <div className="environment-directory-viewport min-w-0 flex-1 overflow-hidden">
        <code
          className="environment-directory-path block w-max min-w-full whitespace-nowrap text-ui-sm"
          title={path ?? undefined}
        >
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
