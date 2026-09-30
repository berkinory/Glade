import {
  RESERVED_VOID_SPACE_ID,
  SPACE_ICON_NAMES,
  type SpaceIconName,
} from "@glade/contracts/orchestration/threadEntities";
import { type SpaceId } from "@glade/contracts/core/baseSchemas";

import type { Space } from "~/types";

const DEFAULT_VOID_SPACE_NAME = "Home";
export const DEFAULT_VOID_SPACE_ICON: SpaceIconName = "home";
export const UNFILED_SPACE_SPECIAL_ICON = "black-hole";

export const DEFAULT_SPACE_ICON: SpaceIconName = "bag";

export type VoidSpaceIconName = SpaceIconName | typeof UNFILED_SPACE_SPECIAL_ICON;

export interface VoidSpacePresentation {
  readonly name: string;
  readonly icon: VoidSpaceIconName;
}

export const DEFAULT_VOID_SPACE: VoidSpacePresentation = {
  name: DEFAULT_VOID_SPACE_NAME,
  icon: DEFAULT_VOID_SPACE_ICON,
};

export function isVoidSpaceIconName(value: string): value is VoidSpaceIconName {
  return (
    value === UNFILED_SPACE_SPECIAL_ICON ||
    (SPACE_ICON_NAMES as ReadonlyArray<string>).includes(value)
  );
}

export function toSpaceIconName(icon: VoidSpaceIconName): SpaceIconName {
  return icon === UNFILED_SPACE_SPECIAL_ICON ? DEFAULT_SPACE_ICON : icon;
}

export const VOID_SPACE_KEY = RESERVED_VOID_SPACE_ID;

export function resolveActiveSpaceId(
  activeSpaceId: SpaceId | null,
  spaces: ReadonlyArray<Space>,
  pendingActiveSpaceId: SpaceId | null = null,
): SpaceId | null {
  return activeSpaceId !== null &&
    (activeSpaceId === pendingActiveSpaceId || spaces.some((space) => space.id === activeSpaceId))
    ? activeSpaceId
    : null;
}

export function spaceKey(spaceId: SpaceId | null): string {
  return spaceId ?? VOID_SPACE_KEY;
}

const UNKNOWN_SPACE_NAME = "Unknown space";

export interface SpaceGroup<T> {
  readonly spaceId: SpaceId | null;
  readonly name: string;
  readonly icon: VoidSpaceIconName;
  readonly isActive: boolean;

  readonly label: string;
  readonly items: ReadonlyArray<T>;

  readonly key: string;
}

export function spaceDisplayName(
  spaceId: SpaceId | null | undefined,
  spaces: ReadonlyArray<Space>,
  voidSpace: VoidSpacePresentation = DEFAULT_VOID_SPACE,
): string {
  if (!spaceId) return voidSpace.name;
  return spaces.find((space) => space.id === spaceId)?.name ?? UNKNOWN_SPACE_NAME;
}

export function spaceDisplayIcon(
  spaceId: SpaceId | null | undefined,
  spaces: ReadonlyArray<Space>,
  voidSpace: VoidSpacePresentation = DEFAULT_VOID_SPACE,
): VoidSpaceIconName {
  if (!spaceId) return voidSpace.icon;
  return spaces.find((space) => space.id === spaceId)?.icon ?? voidSpace.icon;
}

export function orderedSpaceIdsForPicker(
  spaces: ReadonlyArray<Space>,
  activeSpaceId: SpaceId | null,
): ReadonlyArray<SpaceId | null> {
  const rest: ReadonlyArray<SpaceId | null> = [null, ...spaces.map((space) => space.id)].filter(
    (spaceId) => spaceId !== activeSpaceId,
  );
  return [activeSpaceId, ...rest];
}

export function groupItemsBySpace<T>(input: {
  items: ReadonlyArray<T>;
  spaces: ReadonlyArray<Space>;
  activeSpaceId: SpaceId | null;
  spaceIdOf: (item: T) => SpaceId | null;

  voidSpace?: VoidSpacePresentation;
}): ReadonlyArray<SpaceGroup<T>> {
  const { activeSpaceId, items, spaceIdOf, spaces } = input;
  const voidSpace = input.voidSpace ?? DEFAULT_VOID_SPACE;

  const itemsBySpaceId = new Map<SpaceId | null, T[]>();
  for (const item of items) {
    const spaceId = spaceIdOf(item);
    const bucket = itemsBySpaceId.get(spaceId);
    if (bucket) bucket.push(item);
    else itemsBySpaceId.set(spaceId, [item]);
  }

  const orderedSpaceIds = orderedSpaceIdsForPicker(spaces, activeSpaceId);

  const knownSpaceIds = new Set(orderedSpaceIds);
  const orphanSpaceIds = [...itemsBySpaceId.keys()].filter(
    (spaceId) => !knownSpaceIds.has(spaceId),
  );

  return [...orderedSpaceIds, ...orphanSpaceIds].flatMap((spaceId) => {
    const groupItems = itemsBySpaceId.get(spaceId);
    if (!groupItems) return [];
    const isActive = spaceId === activeSpaceId;
    const name = spaceDisplayName(spaceId, spaces, voidSpace);
    return [
      {
        spaceId,
        name,
        icon: spaceDisplayIcon(spaceId, spaces, voidSpace),
        isActive,
        label: isActive ? `${name} · Active` : name,
        items: groupItems,
        key: spaceKey(spaceId),
      } satisfies SpaceGroup<T>,
    ];
  });
}
