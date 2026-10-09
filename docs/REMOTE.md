# Remote access

Use Glade from a phone, a tablet or another computer. The device connects straight to the machine
that runs Glade; there is no relay or hosted service in between. Agents, projects and files stay on
that machine, which has to be awake and reachable while you work.

## In the desktop app

Open **Settings → Remote access** and turn on **Allow other devices**. Then choose how devices
reach this machine:

- **Tailscale HTTPS** (recommended). With Tailscale installed and signed in here and on your
  devices, Glade serves itself at `https://<machine>.<tailnet>.ts.net` through Tailscale Serve.
  Traffic is encrypted and works from anywhere on your tailnet. The first time, Tailscale may ask
  you to turn on HTTPS for your tailnet; Glade shows the link, and **Try again** finishes the setup.
  Glade only adds and removes its own mapping on port 443 and leaves another app's mapping alone.
- **Local network.** Devices on the same Wi-Fi, or on a VPN such as WireGuard, ZeroTier or
  Tailscale without HTTPS, connect over plain HTTP. The traffic is not encrypted, so Glade asks
  before turning this on. Use it only on networks you trust.

Glade listens on port 3773 (or the next free port, kept from then on) only for these connections;
the app's own connection stays on loopback. Connections that arrive on a public internet address
are closed. Turning access off closes every device connection at once. The machine's addresses are
re-read every 30 seconds, so joining another network does not need a restart.

### Pairing a device

Choose **Pair a device**. Scan the QR code with the phone's camera, or open the link on another
computer. The code works once and expires after five minutes. It opens the best address first
(Tailscale HTTPS when it is on) and carries the others for clients that can try them.

Paired devices appear under **Devices** with when they were last used. **Remove** signs a device
out immediately; a browser on that device shows that it was removed and has to be paired again.
Devices stay paired across restarts of Glade.

A paired device can do everything work needs: chats, approvals and questions, files, Git,
terminals, settings and providers. It cannot pair or remove devices, use Computer Use, open the
host's editor, or read thread diagnostics; those stay with the machine's owner.

### Troubleshooting

- **Not reachable yet**: turn on Tailscale HTTPS or the local network; with both off there is no
  address a device can use.
- **A phone cannot open the link on the local network**: check that both are on the same network
  and that the machine's firewall allows incoming connections for Glade (Windows asks the first
  time).
- **The Tailscale address hangs right after turning on HTTPS**: the first connection waits while
  Tailscale gets the machine's certificate, which can take a few minutes. Later connections are
  immediate.
- **Chats stop when the Mac sleeps**: turn on **Keep Mac awake** in Chat settings.

## SSH hosts

An SSH host runs its own Glade server, so a device can pair with it directly. In
**Settings → SSH hosts**, open the host's **…** menu and choose **Remote access**: the same controls
apply to the host, with its own Tailscale and network addresses. A device paired there keeps
working while this computer is off. On Linux, Tailscale HTTPS needs permission once:
`sudo tailscale set --operator=$USER` on the host.

## Command-line server

The server reads these options as flags or environment variables:

| CLI flag                  | Env var                       | Notes                                   |
| ------------------------- | ----------------------------- | --------------------------------------- |
| `--mode <web\|desktop>`   | `GLADE_MODE`                  | Runtime mode.                           |
| `--port <number>`         | `GLADE_PORT`                  | HTTP/WebSocket port.                    |
| `--host <address>`        | `GLADE_HOST`                  | Bind address.                           |
| `--home-dir <path>`       | `GLADE_HOME`                  | Base directory.                         |
| `--no-browser`            | `GLADE_NO_BROWSER`            | Do not open a browser.                  |
| `--auth-token <token>`    | `GLADE_AUTH_TOKEN`            | Required for any non-loopback bind.     |
| `--public-url <url>`      | `GLADE_PUBLIC_URL`            | Your own HTTPS address for this server. |
| `--allow-insecure-remote` | `GLADE_ALLOW_INSECURE_REMOTE` | Accept plain HTTP from the network.     |

A server bound beyond loopback refuses to start without an auth token, and refuses plain HTTP
unless `--public-url` points at an HTTPS origin you proxy to it or `--allow-insecure-remote` is
set. It prints a one-time owner pairing link at startup.

```bash
bun run build
bun run --cwd apps/server start -- --host "$(tailscale ip -4)" --auth-token "$(openssl rand -hex 24)" --allow-insecure-remote --no-browser
```

## How it works

- **Identity.** Every server has a stable environment id. `GET /.well-known/glade/environment`
  returns it with the server's version, protocol range and pairing methods, without
  authentication, so a client can confirm an address reaches the right machine before sending a
  credential.
- **Pairing.** Pairing secrets are single-use, expire after five minutes, and are stored only as a
  SHA-256 digest; listings never include them. The secret and the route list travel in the URL
  fragment, which browsers never send to a server, and the pairing page removes them from history.
  Failed exchanges are throttled per source address.
- **Sessions.** A paired browser holds an HTTP-only session cookie named per install; apps can use
  bearer tokens and short-lived WebSocket tickets. Removing a device revokes its session and closes
  its live connections.
- **Permissions.** Every WebSocket RPC declares the scope it needs in one table
  (`apps/server/src/server/ws/wsRpcScopes.ts`); calls outside the session's scopes are rejected
  before any handler runs.
- **The remote listener.** Desktop remote access opens a second listener that hands its connections
  to the same HTTP server. Requests from it may reach only the app, authentication, the WebSocket
  and file and upload routes; the agent gateway and desktop lifecycle routes stay local. Such
  requests are treated as coming over a wildcard bind, so the desktop's loopback token and
  unauthenticated loopback access never apply to them.
