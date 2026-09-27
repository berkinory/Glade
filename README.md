# Glade

Glade is a local-first coding workspace forked from [Synara](https://github.com/Emanuele-web04/synara).

## Download

Installers will be available on [GitHub Releases](https://github.com/berkinory/Glade/releases)
after the first Glade release. To use Glade now, run it from source below.

## Development

Use the Bun version in `.mise.toml` for development (the pinned Node version is for builds and releases):

```sh
git clone https://github.com/berkinory/Glade.git
cd Glade
bun install --frozen-lockfile
bun run dev
```

Codex and Claude Code must be installed and authenticated separately. See the
[quickstart](docs/quickstart.md) for other development commands.

## Releases

The release workflow builds for macOS, Linux, and Windows. See the
[release guide](docs/release.md) for packaging and updates.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull requests, and
[SECURITY.md](SECURITY.md) for private vulnerability reporting. Glade is licensed
under [MIT](LICENSE).
