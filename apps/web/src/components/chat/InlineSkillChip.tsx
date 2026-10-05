import { BlocksIcon } from "~/lib/icons";
import {
  COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME,
  formatComposerSkillChipLabel,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";
export const InlineSkillChip = function InlineSkillChip(props: { skillName: string }) {
  return (
    <span className={COMPOSER_EDITOR_INLINE_CHIP_CLASS_NAME}>
      <InlineChipContent
        icon={<BlocksIcon className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME} />}
        label={formatComposerSkillChipLabel(props.skillName)}
      />
    </span>
  );
};
