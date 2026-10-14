import { useTheme } from "~/hooks/useTheme";

export function SidebarArtwork() {
  const { resolvedTheme } = useTheme();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[148px] overflow-hidden select-none"
      style={{ maskImage: "linear-gradient(to bottom, black 35%, transparent 100%)" }}
    >
      <img
        src={`/artwork/nyx-${resolvedTheme}.webp`}
        alt=""
        draggable={false}
        className="absolute inset-x-0 top-0 h-48 w-full object-cover object-[50%_35%]"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent 20%, color-mix(in srgb, var(--card) 12%, transparent) 35%, color-mix(in srgb, var(--card) 40%, transparent) 55%, color-mix(in srgb, var(--card) 75%, transparent) 75%, var(--card) 95%)",
        }}
      />
    </div>
  );
}
