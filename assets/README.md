# Glade artwork

Desktop icons use the approved raster backgrounds in `brand/artwork/production.png`
(twilight) and `brand/artwork/development.png` (midnight blue). Both 1254px sources
are background-only plates. Each build has one fixed icon;
theme and saved preferences do not select a different icon.

The exporter overlays the shared vector seal in ivory, centered at exactly 60%
of the tile width in both variants. Both Icon Composer sources use one opaque, full-bleed layer
to preserve the texture and subdued lighting. Smaller exports are filtered from
a full-size render. PNG, ICO and ICNS exports include transparent tile margins.

The matching monochrome seal, with mirrored brackets and a rounded diamond, lives in `apps/web/src/assets/gladeMark.ts`.
`brand/glade.svg` and `brand/glade-master.png` remain its portable vector and
transparent 2048px exports.

To regenerate every platform export, use macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

This updates desktop resources, web favicons, PNG/ICO/ICNS files, and the compiled
production `Assets.car`. Generated exports should not be edited individually.

The background plates were edited with the built-in image generator: preserve
the approved palette and composition, remove the baked-in seal, reduce the light
sweep by another 45%, and modestly increase crisp ordered dither coverage in the
midtones. Keep the twilight peach/lavender curve and midnight-blue diagonal sweep.

## DMG background

`brand/artwork/dmg.png` is the installer scene: a dithered Elysian passage at
twilight, with a wing-carved stone gateway, muted lavender and peach, and quiet
space behind the existing app and Applications positions. It was generated with
the built-in image tool without text or UI; the export adds a crisp arrow and
installation instruction.

```sh
node scripts/generate-dmg-background.ts
```

The export keeps the 642×406 window layout and produces both `dmg-background.png`
and its 1284×812 `@2x` sibling. The DMG builder automatically combines these into
a Retina background. The artwork and installation text are independent of the
Finder icon labels.
