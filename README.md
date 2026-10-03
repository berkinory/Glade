# Glade

Glade is a local-first coding workspace forked from [Synara](https://github.com/Emanuele-web04/synara).

## Install

Download the latest version from [GitHub Releases](https://github.com/berkinory/Glade/releases/latest):

- **macOS (Apple Silicon):** download `Glade-<version>-macOS-arm64.dmg`, open it, and drag `Glade.app` to Applications.
- **macOS (Intel):** download `Glade-<version>-macOS-x64.dmg`, open it, and drag `Glade.app` to Applications.
- **Linux (x64):** download `Glade-<version>-Linux-x86_64.AppImage`, make it executable with `chmod +x Glade-*.AppImage`, then run it.
- **Windows (x64):** download and run `Glade-<version>-Windows-x64.exe`. The installer is unsigned, so Windows SmartScreen may show a warning.

Older releases display the same platform-aware names, while their download URLs and downloaded filenames retain the original names.

On macOS, you can also install Glade from the [Homebrew tap](https://github.com/berkinory/homebrew-brew):

```sh
brew install --cask berkinory/brew/glade
```

Install and authenticate at least one [supported provider](docs/providers.md) before starting a task.
Glade checks GitHub Releases for app updates.

## Development

Use the Bun version in `.mise.toml` for development (the pinned Node version is for builds and releases):

```sh
git clone https://github.com/berkinory/Glade.git
cd Glade
bun install --frozen-lockfile
bun run dev
```

See the [quickstart](docs/quickstart.md) for other development commands.

## Releases

The release workflow builds for macOS, Linux, and Windows. See the
[release guide](docs/release.md) for packaging and updates.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull requests, and
[SECURITY.md](SECURITY.md) for private vulnerability reporting. Glade is licensed
under [MIT](LICENSE).
