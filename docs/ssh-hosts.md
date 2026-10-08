# SSH hosts

The desktop app can run chats on other machines over SSH. Every saved host is an **environment**
next to the local server. Host projects are listed with local ones, and a chat runs on the machine of
its project. Projects, terminals, Git and provider CLIs live on the host; only the interface stays on
your machine.

## Using it

- **Add a host** in **Settings → SSH hosts** (or **File → Connect to SSH Host…**); aliases from your
  `~/.ssh/config` are offered there with one click.
- **Destination** is what you would pass to `ssh`: `user@hostname` or a `Host` alias. Port and key
  file are optional; empty values defer to your SSH config. Aliases are discovered from
  `~/.ssh/config` (following `Include`) and `known_hosts`.
- **Projects on a host** are added from **Add project** by choosing the host as the machine. The path
  field browses the host's folders as you type (`~` is the host's home); a missing folder is created.
  The project picker of a chat on that host adds projects too.
- **Host status** is a dot wherever a host is offered: green connected, amber connecting, grey
  unreachable, red waiting for you. Grey hosts are not offered and are retried in the background
  every 45 s (and on wake); red hosts wait for you and open **Settings → SSH hosts** when clicked.
- **Reconnect** in a host's **…** menu in **Settings → SSH hosts** repairs it: it drops the
  connection, forgets the recorded machine, connects again asking any sign-in questions, and installs
  Glade there when it is missing. A healthy host just reconnects; nothing is reinstalled.
- **Host projects** sit in the project list with local ones, marked with a server badge that shows
  the host and its connection state.
- **New chats** in Home pick their machine in the environment picker (**Local**, or a host under
  **SSH**); a project's chats run on the project's machine. The choice is fixed once the chat has a
  message.
- **A chat on a host** shows the host's name and a status dot beside the composer's controls. Hovering
  explains the state; clicking reconnects a host that is not connected.
- **Manual project order** spans machines and is kept on this machine; a host's projects keep their
  place while it is offline.
- **Spaces** hold host projects too; a host project's space is kept on this machine, since spaces
  belong to the local server.
- **Signing in.** Glade runs your system `ssh`. Questions ssh asks (a password, a key passphrase, or
  whether to trust an unknown host key, with its fingerprint) appear as dialogs when you connect.
  Connections Glade starts on its own (at launch, after a dropped connection) never ask; they use
  answers given earlier in this session and otherwise stop with a sign-in message until you
  connect. Passwords are kept in memory only, and a rejected login forgets them. ssh refuses a host
  whose key changed without asking; remove the old key with `ssh-keygen -R` if the host was
  reinstalled.
- **One machine per host entry.** The first connection records the machine (an id stored in
  `~/.glade/remote/machine-id` on the host). If the destination later reaches another machine, Glade
  refuses to connect and marks the host red; **Reconnect** adopts the new machine.
- The host must run Linux (glibc 2.31 or newer, x64) or macOS (arm64 or x64), and needs `sh`, `tar`,
  `uname`, `od`, `sha256sum` or `shasum`, and `curl` or `wget` with HTTPS access to github.com.
  Provider CLIs (`claude`, `codex`) must be installed and signed in on the host, on its login-shell
  `PATH`.
- Saved hosts connect when Glade starts and again after the Mac wakes. A host's chats keep running
  while Glade is closed and show their results when it reconnects; quitting asks only about chats on
  this machine.
- Chats on a host have no folder picker, Finder reveal, dropped local file paths, agent browser,
  computer use or local servers list. Cursor and VS Code open host folders through their Remote-SSH
  extension when the host's SSH config alias reaches it (no port or key file saved only in Glade).
- Settings, keybindings, spaces, usage and profile stats stay local.

## Server side

1. **Probe.** `ssh host 'sh -c …'` reads `uname -s` and `uname -m` for the bundle target, the host's
   machine id, and the version and build of the server it already runs.
2. **Choose a build.** A host that runs a newer Glade keeps it: an older server cannot open a database
   a newer one migrated, so Glade never downgrades a host. The app connects when the protocol is
   compatible and otherwise reports **Needs a newer Glade**. In every other case the host gets this
   desktop's build.
3. **Install.** Each build lives in
   `~/.glade/remote/runtime/glade-remote-server-<version>-<target>-<digest>/`, named by the bundle
   digest so two builds of one version never share a directory. Released desktops have the host
   download the bundle from the GitHub release; source and development builds, which have no
   release, stream a locally built bundle over ssh stdin. Either way the archive's SHA-256 is checked,
   it is unpacked into a staging directory, the bundled dependency smoke test runs on the host, and
   only then is it renamed into place.
4. **Launch.** The bundled `dist/remoteLauncher.mjs`, run with the bundled Node, starts one detached
   server per host (`GLADE_MODE=desktop`, loopback only, a fresh auth token, `GLADE_HOME` at
   `~/.glade/remote/home`) or reuses the running one. An older server, or another build of the same
   version, is stopped through its shutdown token first; a newer one keeps running. Builds other than
   the running one are then deleted. State is in `~/.glade/remote/server.json` (mode 0600) and the
   log in `~/.glade/remote/server.log`.
5. **Tunnel.** A separate, non-multiplexed `ssh -N -L` forwards a local loopback port to the server's
   port. The host's WebSocket URL points at that local port.

Commands share one multiplexed SSH connection (`ControlMaster`) except on Windows. The tunnel opts
out because forwards requested through a shared master outlive the client that requested them.

ssh's questions reach Glade through `SSH_ASKPASS`: a small helper, run by Glade's own binary in Node
mode, forwards each question over a private local socket to the desktop main process, which shows it
in the window (`apps/desktop/src/remote/sshAskpass.ts`). ssh writes accepted host keys to
`known_hosts` itself.

ssh sends a keepalive every 5 s and drops a tunnel after three go unanswered, so a silent network
loss is noticed within ~15 s; the chat's own connection reports an unanswering host after ~3 s. A
closed tunnel moves the host to **Reconnecting** and retries with backoff (1 s doubling to 10 s,
reset once a connection stays up for 30 s) on the same local port, so the renderer's own reconnect
simply succeeds again. Waking the Mac retries at once. A tunnel stays up when the server behind it
dies, so the desktop polls `/health` through it every 15 s; two refused checks restart the cycle and
the launcher starts a new server. A new server has a new token, so the renderer replaces that host's
connection and reloads its projection. Health-check timeouts are ignored: a busy server may stall for
a minute.

Connections belong to the desktop main process (`apps/desktop/src/remote`), not to windows. Saved
hosts and their machine ids live in `<GLADE_HOME>/userdata/desktop-ssh-hosts.json`.

## Renderer side

Each environment has its own `WsTransport` and `NativeApi`, its own app store and its own stream
runtime (`apps/web/src/environments`, `routes/-rootEnvironmentRouters.tsx`). Reducers, snapshot
replacement, sequences and tombstones therefore stay per server; a host's store never touches the
local server's persisted project UI state or visit scope.

- **`useStore`** reads a merged view of every environment's store. Records are keyed by UUIDs, so
  merging is a union; actions that name a thread or project run on the store that owns it. With only
  the local server it is the local store itself.
- **`readNativeApi()`** returns a router. Calls naming a thread or project go to its environment;
  path-only calls go to the environment whose project or worktree contains the path (ties go to the
  chat on screen); server-wide calls (settings, auth, usage) and new projects go to the local server.
  `ensureEnvironmentNativeApi(key)` is for calls that pick a host on purpose.
- **The active environment** is the routed chat's. It decides where unrouted calls go, which server
  config the composer's providers come from, and whether local-only features show.
- Persisted client state pruned against known threads (pins, terminal state, recent views) waits until
  every environment applied a snapshot, so an offline host keeps its entries.

## Server bundles

`scripts/build-remote-server.ts --target <linux-x64|linux-arm64|darwin-x64|darwin-arm64>` builds
`glade-remote-server-<version>-<target>.tar.gz` and its `.sha256` file. A bundle contains the pinned
official Node.js runtime (`scripts/remote-node-runtime.json`, verified by SHA-256),
`apps/server/dist` without the web client, and production `node_modules` installed from `bun.lock`
without type declarations or source maps. Linux targets compile node-pty and run the smoke tests
inside a `node:22-bullseye` container, which needs Docker; macOS targets use node-pty's prebuilds and
run the smoke tests when the build host matches.

- **Source and development builds** read bundles from `release/remote/` (or
  `GLADE_REMOTE_SERVER_BUNDLE_DIR`). Build one with `bun run --cwd apps/server build:dev` and then
  `bun run package:remote-server -- --target linux-x64`.
- **Packaged builds** read the bundle's `.sha256` file from the GitHub release for their own version
  and have the host download the bundle itself. Releases publish `darwin-arm64`, `darwin-x64` and
  `linux-x64` bundles. There is no Linux arm64 release runner yet, so arm64 Linux hosts need a source
  build for now.
