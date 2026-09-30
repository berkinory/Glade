import { SPACE_NAME_MAX_LENGTH } from "@glade/contracts/orchestration/orchestration";
import { useEffect, useId, useRef, useState } from "react";

import { handleRadioGridKeyDown } from "~/lib/radioGridKeyboard";
import { DEFAULT_SPACE_ICON, DEFAULT_VOID_SPACE_ICON } from "~/lib/spaceGrouping";
import { suggestSpaceIcon } from "~/lib/spaceIconSuggestion";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  dialogFieldLabelClassName,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  SPACE_ICON_OPTIONS,
  SpaceIcon,
  VOID_SPACE_ICON_OPTIONS,
  type SpaceIconValue,
} from "./SpaceIcon";
import { cn } from "~/lib/utils";

const FIELD_LABEL_CLASS_NAME = dialogFieldLabelClassName;

const ICON_CELL_CLASS_NAME =
  "flex aspect-square cursor-pointer items-center justify-center rounded-lg border text-muted-foreground transition-colors outline-hidden hover:bg-foreground/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

export interface SpaceEditorValue {
  readonly name: string;
  readonly icon: SpaceIconValue;
}

export type SpaceEditorMode = "create" | "edit" | "void";

export function SpaceEditorDialog(props: {
  open: boolean;
  mode: SpaceEditorMode;
  initialValue?: SpaceEditorValue | undefined;

  existingNames: ReadonlyArray<string>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: SpaceEditorValue) => Promise<void> | void;
}) {
  const isVoid = props.mode === "void";
  const iconOptions = isVoid ? VOID_SPACE_ICON_OPTIONS : SPACE_ICON_OPTIONS;
  const defaultIcon: SpaceIconValue = isVoid ? DEFAULT_VOID_SPACE_ICON : DEFAULT_SPACE_ICON;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<SpaceIconValue>(defaultIcon);
  // Editing starts pinned: a rename must never silently swap an icon someone already chose.
  const [iconPinned, setIconPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const openedRef = useRef(false);
  const fieldId = useId();
  const nameInputId = `${fieldId}-name`;
  const nameErrorId = `${fieldId}-name-error`;
  const iconLegendId = `${fieldId}-icon-legend`;

  useEffect(() => {
    if (props.open === openedRef.current) return;
    openedRef.current = props.open;
    if (!props.open) return;
    setName(props.initialValue?.name ?? "");
    setIcon(props.initialValue?.icon ?? defaultIcon);
    setIconPinned(props.mode !== "create");
    setSubmitting(false);
    setSubmitError(null);

    const frame = requestAnimationFrame(() => nameInputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [defaultIcon, props.initialValue?.icon, props.initialValue?.name, props.mode, props.open]);

  const trimmedName = name.trim();
  const duplicateName = props.existingNames.some(
    (existingName) => existingName.trim().toLowerCase() === trimmedName.toLowerCase(),
  );
  const nameError =
    trimmedName.length === 0
      ? "Enter a name."
      : duplicateName
        ? "That name is already taken."
        : null;

  const visibleNameError = name.length > 0 ? nameError : null;

  const submit = async () => {
    if (nameError || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await props.onSubmit({ name: trimmedName, icon });
      props.onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to save the space.");
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {props.mode === "create" ? "New space" : isVoid ? "Edit unfiled group" : "Edit space"}
          </DialogTitle>
          <DialogDescription>
            {props.mode === "create"
              ? "Group projects into a focused work context. Projects you add while a space is open land in it."
              : isVoid
                ? "Name the group that holds projects you haven't filed into a space. This is a local preference — the projects in it stay where they are."
                : "Rename this space or give it a different icon. Its projects stay where they are."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {}
          <div className="space-y-1.5">
            <label htmlFor={nameInputId} className={cn("block", FIELD_LABEL_CLASS_NAME)}>
              Name
            </label>
            <Input
              id={nameInputId}
              ref={nameInputRef}
              value={name}
              maxLength={SPACE_NAME_MAX_LENGTH}
              aria-invalid={Boolean(visibleNameError)}
              {...(visibleNameError ? { "aria-describedby": nameErrorId } : {})}
              onChange={(event) => {
                setName(event.target.value);

                if (!iconPinned) setIcon(suggestSpaceIcon(event.target.value));
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder={isVoid ? "Unfiled" : "Work"}
            />
            {visibleNameError ? (
              <p id={nameErrorId} role="alert" className="text-ui-xs text-destructive">
                {visibleNameError}
              </p>
            ) : null}
          </div>

          <fieldset>
            <legend id={iconLegendId} className={cn("mb-2", FIELD_LABEL_CLASS_NAME)}>
              Icon
            </legend>
            <div
              role="radiogroup"
              aria-labelledby={iconLegendId}
              onKeyDown={(event) => handleRadioGridKeyDown(event, "[data-space-icon]")}
              className="grid grid-cols-10 gap-1.5 max-sm:grid-cols-5"
            >
              {iconOptions.map((option) => {
                const selected = icon === option.name;
                return (
                  <button
                    key={option.name}
                    type="button"
                    role="radio"
                    data-space-icon
                    aria-checked={selected}
                    aria-label={option.label}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      setIcon(option.name);
                      setIconPinned(true);
                    }}
                    className={cn(
                      ICON_CELL_CLASS_NAME,
                      selected
                        ? "border-foreground/25 bg-foreground/9 text-foreground"
                        : "border-transparent bg-foreground/3",
                    )}
                  >
                    <SpaceIcon icon={option.name} />
                  </button>
                );
              })}
            </div>
          </fieldset>
          {submitError ? (
            <p role="alert" className="text-ui-xs text-destructive">
              {submitError}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={Boolean(nameError) || submitting}>
            {submitting ? "Saving…" : props.mode === "create" ? "Create space" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
