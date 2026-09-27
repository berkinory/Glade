# Glade releases

Glade's version history starts at **0.0.1**. One stable GitHub Release contains a universal macOS DMG and update ZIP (Apple Silicon and Intel), a Linux x64 AppImage, and a Windows x64 NSIS installer. The update feed belongs to the public `berkinory/Glade` repository. There is no alternate release channel.

## Identity and artifacts

- Application: `Glade.app`; bundle ID: `com.agent.glade`; protocol: `glade://`.
- Data: `~/.glade`; Electron profile: `glade`.
- Dedicated updater manifests: `glade-mac.yml`, `glade-linux.yml`, and `glade.yml`, copied from the finalized `latest-*` manifests.
- The macOS ZIP is for automatic updates; the DMG is for manual installation. The Linux AppImage and Windows NSIS installer serve both purposes.
- Windows is intentionally unsigned. The installer runs, but Windows SmartScreen may display an unrecognized-app warning until signing and reputation are established.

The release workflow hashes and checks all platform artifacts against their source commit and `bun.lock`, verifies the signed macOS app, then assembles one `SHA256SUMS.txt`. Release metadata and the ZIP describe the final signed, notarized app. Do not edit a packaged app after signing.

## Local builds

Install the versions in `.mise.toml`, Xcode, and the Rust toolchain pinned in `packages/shared/src/cuaDriverRelease.json`. Run `bun install --frozen-lockfile`. Build each platform on its matching host:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false bun run package:mac
bun run package:linux
bun run package:win
```

The macOS command builds a single universal DMG and ZIP. An unsigned local artifact is for development, not public distribution. The macOS build uses `assets/prod/Glade-Assets.car`, a compiled icon catalog checked in for hosted Xcode 16.4. When the icon changes, regenerate all artwork on macOS with ImageMagick and Xcode 26:

```sh
node scripts/generate-brand-assets.ts
```

See [artwork sources](../assets/README.md) for the shared mark and platform variants.

For a local signed macOS build, install a **Developer ID Application** certificate with its private key and save notarization credentials interactively:

```sh
xcrun notarytool store-credentials Glade --team-id 8M2GQK3TUP
CSC_NAME='Pixen Interactive LLC (8M2GQK3TUP)' \
APPLE_TEAM_ID=8M2GQK3TUP GLADE_NOTARY_PROFILE=Glade \
bun run package:mac -- --signed
```

Artifacts land in `release/`. Local notarization uses the keychain profile; CI uses App Store Connect API credentials. Never commit private keys or passwords.

## GitHub Actions

`.github/workflows/release.yml` runs checks first. Only after they pass does it build the three
platforms in parallel; a failed check skips every platform build and publication. A manual run with
`publish_release=false` produces workflow artifacts without a GitHub Release. Pushing a stable
`vX.Y.Z` tag publishes all three after checks, signing and notarization; manual publication also
requires running on that exact tag. Existing releases are never overwritten. The Cua native cache
refreshes weekly and when its build inputs change, with only the macOS universal and Linux x64
release variants. Native macOS and Linux Cua checks run on relevant pull requests and direct pushes
to `glade`.

Set these repository Actions secrets before publishing. The macOS signing identity and App Store Connect key must belong to team `8M2GQK3TUP`:

- `CSC_LINK`: base64-encoded PKCS#12 export of the chosen Developer ID Application identity.
- `CSC_KEY_PASSWORD`: password for that export.
- `APPLE_API_KEY`: contents of an App Store Connect API `.p8` key permitted to notarize.
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`: matching account identifiers.

The local keychain does not transfer to GitHub runners. Missing Apple secrets stop publication. Windows needs no signing secrets. This workflow does not publish npm packages or generate version commits.

## Cut a version

1. Align package versions with `node scripts/update-release-package-versions.ts X.Y.Z`, then refresh `bun.lock` with `bun install --lockfile-only --ignore-scripts`.
2. Update `CHANGELOG.md` and `apps/web/src/whatsNew/entries.ts`. Mark a version released only when it really ships.
3. Run `bun run check`, `bun run test`, `bun scripts/check-windows-runtime-boundary.ts`, and `bun scripts/check-migration-lineage.ts`. Check the packaged app with an isolated profile on each supported platform.
4. Commit the reviewed source on `glade`, tag that exact commit `vX.Y.Z`, and push the branch and that tag to `origin`. Do not push inherited upstream tags.
5. Verify the GitHub Release has all three installers, macOS update ZIP, platform update manifests, provenance JSON files, and `SHA256SUMS.txt`.

## Development and production

Only Dev and Prod are supported. Dev uses blueprint artwork and an isolated profile; Prod uses production artwork and the stable update feed. See [product scope](glade-feature-scope.md).

## Changelog format

Keep the newest version first, with `Unreleased` until publication and an ISO date once released. Group entries under `Added`, `Improved`, `Fixed`, `Removed`, `Deprecated`, or `Security`; omit empty groups. Describe observable behavior in one concise bullet per change.

When a change has an actual commit, append its short hash linked to the full SHA: `- Change description. ([SHORT_SHA](https://github.com/berkinory/Glade/commit/FULL_SHA))`. Do not invent hashes or use an unrelated commit. Uncommitted changes have no link. Mirror these categories in the in-app notes; their optional `commit` field renders the linked hash.
