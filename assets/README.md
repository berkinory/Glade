# Glade artwork

The Glade mark is two rounded brackets around a centered square. Its monochrome geometry
lives in `apps/web/src/assets/gladeMark.ts`, shared by the UI and asset exporter.
`brand/glade.svg` and `brand/glade-master.png` are the portable vector and
transparent 2048px exports. `brand/artwork/` preserves the approved light, dark,
and dev raster artwork and their shared foreground mask.

Prod uses a dark mark on a warm light particle field, with a separate dark
appearance. Both share identical geometry and particle placement. Dev uses the
same mark in white on the blue blueprint background. The production macOS
catalog uses the complete light artwork to preserve its texture; the dev
Icon Composer source keeps the white foreground and blueprint separate.

To regenerate every platform export, use macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

This updates the desktop resources, settings previews, web favicons, PNG/ICO/ICNS
files, and the compiled production `Assets.car`. Run it after changing the mark
or approved artwork. Generated exports should not be edited individually.
