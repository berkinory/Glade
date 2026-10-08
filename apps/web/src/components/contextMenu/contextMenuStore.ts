import { create } from "zustand";
import type { IconComponent } from "~/lib/iconComponent";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  icon: IconComponent;
  separatorBefore?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface OpenContextMenu {
  key: number;
  items: readonly ContextMenuItem[];
  position: ContextMenuPosition;
  resolve: (id: string | null) => void;
}

const useContextMenuStore = create<{ menu: OpenContextMenu | null }>(() => ({ menu: null }));

let nextMenuKey = 0;

export function showContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position: ContextMenuPosition,
): Promise<T | null> {
  closeContextMenu(null);
  if (items.length === 0) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    useContextMenuStore.setState({
      menu: {
        key: ++nextMenuKey,
        items,
        position,
        // Only ids from `items` (all of type T) or null are ever passed back.
        resolve: resolve as (id: string | null) => void,
      },
    });
  });
}

export function closeContextMenu(id: string | null): void {
  const { menu } = useContextMenuStore.getState();
  if (!menu) return;
  useContextMenuStore.setState({ menu: null });
  menu.resolve(id);
}

export function useOpenContextMenu(): OpenContextMenu | null {
  return useContextMenuStore((state) => state.menu);
}
