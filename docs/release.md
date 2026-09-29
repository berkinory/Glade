# Glade releases

Glade's version history starts at **0.0.1**. One stable GitHub Release contains separate macOS DMGs and update ZIPs for Apple Silicon and Intel, a Linux x64 AppImage, and a Windows x64 NSIS installer. The update feed belongs to the public `berkinory/Glade` repository. There is no alternate release channel.

## Identity and artifacts

- Application: `Glade.app`; bundle ID: `com.agent.glade`; protocol: `glade://`.
- Data: `~/.glade`; Electron profile: `glade`.
- Dedicated updater manifests: `glade-mac.yml`, `glade-linux.yml`, and `glade.yml`. The macOS manifest combines the verified arm64 and x64 ZIP entries so existing installations update to the matching architecture.
- The macOS ZIP is for automatic updates; the DMG is for manual installation. The Linux AppImage and Windows NSIS installer serve both purposes.
- Windows is intentionally unsigned. The installer runs, but Windows SmartScreen may display an unrecognized-app warning until signing and reputation are established.

The release workflow hashes and checks all platform artifacts against their source commit and `bun.lock`, verifies both signed macOS apps, then puts installer links and SHA-256 checksums in the release notes. The four platform provenance records and `latest-*` manifests are verified in CI but are not published as release assets. Release metadata and the ZIP describe the final signed, notarized app. Do not edit a packaged app after signing.

## Local builds

Install the versions in `.mise.toml`, Xcode, and the Rust toolchain pinned in `packages/shared/src/cuaDriverRelease.json`. Run `bun install --frozen-lockfile`. Build each platform on its matching host:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac:arm64
CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac:x64
bun run package:linux
bun run package:win
```

Each macOS command builds a DMG and update ZIP for one architecture. An unsigned local artifact is for development, not public distribution. The macOS build uses `assets/prod/Glade-Assets.car`, a compiled icon catalog checked in for hosted Xcode 16.4. When the icon changes, regenerate all artwork on macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

See [artwork sources](../assets/README.md) for the shared mark and platform variants.

For a local signed macOS build, install a **Developer ID Application** certificate with its private key and save notarization credentials interactively:

```sh
xcrun notarytool store-credentials Glade --team-id 8M2GQK3TUP
CSC_NAME='Pixen Interactive LLC (8M2GQK3TUP)' \
APPLE_TEAM_ID=8M2GQK3TUP GLADE_NOTARY_PROFILE=Glade \
bun run package:mac:arm64 -- --signed
```

Artifacts land in `release/`. Local notarization uses the keychain profile; CI uses App Store Connect API credentials. Never commit private keys or passwords.

## GitHub Actions

`.github/workflows/release.yml` verifies the release source and requires successful CI for the
exact commit on `main` before publishing. It reuses that result instead of rerunning the same checks
on the tag. An unpublished manual build runs the checks itself. A failed gate skips all four builds
and publication. The four build jobs run in parallel. Pushing a stable `vX.Y.Z` tag publishes only
after both macOS packages are signed and notarized; manual publication also requires running on that
exact tag. Existing releases are never overwritten. The Cua native cache refreshes weekly and when
its build inputs change for macOS arm64, macOS x64 and Linux x64. Native macOS and Linux Cua checks
run on relevant pull requests and direct pushes to `main`.

After a published release is assembled, the dependent `sync-homebrew` job dispatches the
`update-glade-cask.yml` workflow in `berkinory/homebrew-brew`. Set `HOMEBREW_TAP_TOKEN` in Glade's
Actions secrets to a fine-grained token with Actions write access to that tap. The tap workflow
reads both published macOS DMGs' SHA-256 digests and commits the architecture-aware cask. The cask declares
`auto_updates true` because the installed app uses Glade's own update feed.

Set these repository Actions secrets before publishing. The macOS signing identity and App Store Connect key must belong to team `8M2GQK3TUP`:

- `CSC_LINK`: base64-encoded PKCS#12 export of the chosen Developer ID Application identity.
- `CSC_KEY_PASSWORD`: password for that export.
- `APPLE_API_KEY`: contents of an App Store Connect API `.p8` key permitted to notarize.
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`: matching account identifiers.

The local keychain does not transfer to GitHub runners. Missing Apple secrets stop publication. Windows needs no signing secrets. This workflow does not publish npm packages or generate version commits.

## Cut a version

1. Align package versions with `node scripts/update-release-package-versions.ts X.Y.Z`, then refresh `bun.lock` with `bun install --lockfile-only --ignore-scripts`.
2. Update `CHANGELOG.md` and `apps/web/src/whatsNew/entries.ts`. Use `New` for newly available capabilities, `Improved` for refinements, `Fixed` for corrected behavior, and `Removed` for retired functionality. Keep category names consistent with the app release-note headings. Mark a version released only when it really ships.
3. Run `bun run check`, `bun run test`, `bun scripts/check-windows-runtime-boundary.ts`, and `bun scripts/check-migration-lineage.ts`. Check the packaged app with an isolated profile on each supported platform.
4. Commit the reviewed source on `main` and push it to `origin`. Wait for exact-commit CI and warm the Cua release cache before tagging that commit `vX.Y.Z` and pushing the tag. Do not push inherited upstream tags.
5. Verify the GitHub Release notes link all four installers and list their SHA-256 checksums. The ten assets are four installers, two macOS update ZIPs, three platform update manifests, and the Windows blockmap. Verify both Homebrew architecture checksums.

## Development and production

Only Dev and Prod are supported. Dev uses blueprint artwork and an isolated profile; Prod uses production artwork and the stable update feed. See [product scope](glade-feature-scope.md).

## Changelog format

Keep the newest version first, with `Unreleased` until publication and an ISO date once released. Group entries under `New`, `Improved`, `Fixed`, `Removed`, `Deprecated`, or `Security`; omit empty groups. Describe observable behavior in one concise bullet per change. Merge related work into one entry, omit minor cosmetic fixes and implementation details, and link the commits that introduced the behavior.

When a change has an actual commit, append its short hash linked to the full SHA: `- Change description. ([SHORT_SHA](https://github.com/berkinory/Glade/commit/FULL_SHA))`. Do not invent hashes or use an unrelated commit. Uncommitted changes have no link. Mirror these categories in the in-app notes; their optional `commit` field renders the linked hash.
