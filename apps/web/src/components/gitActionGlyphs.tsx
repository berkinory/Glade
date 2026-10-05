import {
  CloudIcon,
  WorkflowCircle04Icon,
  GitCommitHorizontalIcon,
  CloudUploadIcon,
} from "~/lib/icons";
import { GitHubIcon } from "~/lib/brandIcons";
import type { IconComponent } from "~/lib/iconComponent";
import type { GitGlyphName } from "./GitActionsControl.logic";
export const GIT_ACTION_ICON_CLASS = "size-3.5";
const GIT_ACTION_GLYPH: Record<GitGlyphName, IconComponent> = {
  commit: GitCommitHorizontalIcon,
  push: CloudUploadIcon,
  pr: GitHubIcon,
  sync: CloudIcon,
  branch: WorkflowCircle04Icon,
};
export function GitActionGlyph({ name, className }: { name: GitGlyphName; className?: string }) {
  const Glyph = GIT_ACTION_GLYPH[name];
  return <Glyph className={className ?? GIT_ACTION_ICON_CLASS} />;
}
