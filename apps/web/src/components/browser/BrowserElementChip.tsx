import type { BrowserElementReference } from "~/lib/browserElementReference";
import { CursorInWindowIcon } from "~/lib/icons";
import {
  COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  COMPOSER_INLINE_LINK_CHIP_CLASS_NAME,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";

export function BrowserElementChip(props: { reference: BrowserElementReference }) {
  return (
    <span
      className={COMPOSER_INLINE_LINK_CHIP_CLASS_NAME}
      title={props.reference.details}
      contentEditable={false}
      suppressContentEditableWarning
      spellCheck={false}
    >
      <InlineChipContent
        icon={<CursorInWindowIcon className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME} />}
        label={props.reference.label}
      />
    </span>
  );
}
