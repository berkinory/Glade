# Glade artwork

The Glade mark is two rounded brackets around a centered square. Its monochrome geometry
lives in `apps/web/src/assets/gladeMark.ts`, shared by the UI and asset exporter.
`brand/glade.svg` and `brand/glade-master.png` are the portable vector and
transparent 2048px exports. `brand/artwork/` holds the approved light, dark,
and dev ASCII-field backgrounds as 1024px plates without the mark.

The exporter places every plate in the icon tile and draws the vector mark on
top at the same size and exact center, so all variants share one alignment.
Prod uses a dark mark on a warm light ASCII field, with a separate dark
appearance in cream on black. Dev uses a white mark on a blueprint-blue field.
The production macOS catalog flattens plate and mark into one layer; the dev
Icon Composer source keeps the glass mark and blueprint separate. Frames of
16px and below use a flat tile, because the texture is only noise at that size.

To regenerate every platform export, use macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

This updates the desktop resources, settings previews, web favicons, PNG/ICO/ICNS
files, and the compiled production `Assets.car`. Run it after changing the mark
or approved artwork. Generated exports should not be edited individually.
