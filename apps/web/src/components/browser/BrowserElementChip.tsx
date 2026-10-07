import {
  describeBrowserElementReference,
  type BrowserElementReference,
} from "~/lib/browserElementReference";
import { CursorInWindowIcon } from "~/lib/icons";
import {
  COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME,
  COMPOSER_INLINE_LINK_CHIP_CLASS_NAME,
} from "../composerInlineChip";
import { InlineChipContent } from "../InlineChip";

export function BrowserElementChip(props: { reference: BrowserElementReference }) {
  const label = describeBrowserElementReference(props.reference);
  return (
    <span
      className={COMPOSER_INLINE_LINK_CHIP_CLASS_NAME}
      title={`${label} · ${props.reference.ref} on ${props.reference.tabId} · ${props.reference.url}`}
      contentEditable={false}
      suppressContentEditableWarning
      spellCheck={false}
    >
      <InlineChipContent
        icon={<CursorInWindowIcon className={COMPOSER_INLINE_CHIP_INLINE_ICON_CLASS_NAME} />}
        label={label}
      />
    </span>
  );
}
