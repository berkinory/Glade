import { Dialog, DialogPopup, DialogTrigger } from "~/components/ui/dialog";

// URLs only: an image loads when its release notes are shown, not with the bundle.
// They are rendered by scripts/release-bento/render.ts.
const IMAGES = import.meta.glob<string>("./releases/*.avif", {
  eager: true,
  query: "?url",
  import: "default",
});

export function ReleaseVisual({ version }: { readonly version: string }) {
  const src = IMAGES[`./releases/${version}.avif`];
  if (!src) return null;
  const alt = `Overview of Glade ${version}`;
  return (
    <Dialog>
      <DialogTrigger
        aria-label={`Enlarge the overview of Glade ${version}`}
        className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border"
      >
        <img src={src} alt={alt} className="block aspect-[8/5] w-full" draggable={false} />
      </DialogTrigger>
      <DialogPopup className="w-auto max-w-none p-1.5" bottomStickOnMobile={false}>
        {/* 136vh is 85vh of height at the image's 8:5 aspect ratio. */}
        <img
          src={src}
          alt={alt}
          className="block aspect-[8/5] w-[min(92vw,1600px,136vh)] rounded-[1.1rem]"
          draggable={false}
        />
      </DialogPopup>
    </Dialog>
  );
}
