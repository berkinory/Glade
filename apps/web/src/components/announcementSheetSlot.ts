import { useEffect, useId } from "react";
import { create } from "zustand";

interface AnnouncementSheetSlotStore {
  owner: string | null;

  handedOff: boolean;
  claim: (id: string) => void;
  release: (id: string) => void;
  handOff: () => void;
}

const useAnnouncementSheetSlotStore = create<AnnouncementSheetSlotStore>((set) => ({
  owner: null,
  handedOff: false,
  claim: (id) => set((state) => (state.owner === null && !state.handedOff ? { owner: id } : state)),
  release: (id) => set((state) => (state.owner === id ? { owner: null } : state)),
  handOff: () => set({ handedOff: true }),
}));

export function useAnnouncementSheetSlot(wantsOpen: boolean): {
  open: boolean;
  handOff: () => void;
} {
  const id = useId();
  const owner = useAnnouncementSheetSlotStore((state) => state.owner);
  const claim = useAnnouncementSheetSlotStore((state) => state.claim);
  const release = useAnnouncementSheetSlotStore((state) => state.release);
  const handOff = useAnnouncementSheetSlotStore((state) => state.handOff);

  useEffect(() => {
    if (wantsOpen) claim(id);
    else release(id);
  }, [claim, id, owner, release, wantsOpen]);
  useEffect(() => () => release(id), [id, release]);

  return { open: wantsOpen && owner === id, handOff };
}
