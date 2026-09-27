# Glade artwork

The Glade mark is four curved pieces surrounding an open center. Its geometry
lives in `apps/web/src/assets/gladeMark.ts`, shared by the UI and asset exporter.
`brand/glade.svg` and `brand/glade-master.png` are the portable vector and
transparent 2048px exports. `brand/glade-reference.png` preserves the selected
ImageGen design used to construct the symmetrical vector.

Prod uses a black mark on a light tile, with a separate dark appearance. Dev
uses the same mark on the blue blueprint background. The macOS `.icon` sources
keep foreground and background layers separate for Liquid Glass.

To regenerate every platform export, use macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

This updates the desktop resources, settings previews, web favicons, PNG/ICO/ICNS
files, and the compiled production `Assets.car`. Run it after changing the mark
or blueprint background. Generated exports should not be edited individually.
