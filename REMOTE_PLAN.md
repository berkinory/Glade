# Remote access plan

Use Glade from another device: a phone, a tablet, or another computer's Glade. The device connects
directly to a machine running a Glade server: this Mac, or an SSH host such as a home server. Agents
keep running on that machine; the device is only a client.

A mobile client is not part of this work, but everything here is built so it can plug in later
without protocol changes. The browser keeps working as a fallback, but it is not a design target.

## Goals

- One model for every machine: an **environment** reached over one or more **routes**, joined by
  **pairing** once, and used through a **session** with explicit permissions.
- No lock-in to a VPN. Any network the device shares with the machine works: the same LAN,
  WireGuard, ZeroTier, Tailscale or a user's own HTTPS URL. Tailscale is supported as the most
  convenient HTTPS option, not required.
- One QR code per pairing. The user never chooses between addresses.
- A device can pair with any number of environments and use them together, the way the desktop
  already shows local and SSH host projects side by side.
- The same flow on macOS, Linux and Windows hosts, including headless servers.

## Non-goals

- No relay or hosted service of any kind. Glade never runs infrastructure between a device and a
  machine.
- No mobile app, PWA work or mobile layout pass in this plan.
- No proxying of SSH hosts through the Mac. A device pairs with a host directly.
- No exposure to the public internet by default. Public reachability is the user's own HTTPS URL.

## What already exists

Inherited server auth covers much of the foundation; the plan hardens and extends it rather than
replacing it.

- The server can bind beyond loopback (`--host`), refuses remote exposure without auth, refuses
  plaintext remote access unless `--allow-insecure-remote` or an HTTPS `--public-url` is set
  (`apps/server/src/server/config.ts`), and serves the web client itself.
- Pairing: one-time credentials (5 minutes), `/pair#token=…` links, persisted pairing links
  (`apps/server/src/auth/`, `persistence/Layers/AuthPairingLinks.ts`).
- Sessions: browser cookie and bearer, 30-day lifetime, device metadata, `owner` / `client` roles,
  revoke and revoke-others, short-lived WebSocket tokens (`http/authRoutes.ts`,
  `persistence/Layers/AuthSessions.ts`).
- Origin checks on the WebSocket upgrade and cookie-authenticated mutations
  (`http/trustedOrigins.ts`).
- Many clients per server, all fed by the same orchestration snapshot and event stream.
- A stable environment identity: `environmentId` is generated once and written atomically to the
  server state directory (`apps/server/src/environment/Layers/ServerEnvironment.ts`). Its
  descriptor (id, label, platform, version, capabilities) is served only over the authenticated
  WebSocket RPC today.
- Session tokens are signed and verified with a timing-safe comparison
  (`auth/Layers/SessionCredentialService.ts`).
- The renderer already runs several environments at once with a merged store and routed API
  (`apps/web/src/environments/`), built for SSH hosts.

Gaps:

- The desktop backend is always loopback-only.
- There is no UI to pair or manage devices.
- Authorization is a two-role split instead of declared permissions.
- There is no route model and no unauthenticated descriptor to verify a route.
- Pairing secrets are stored in plain text (`persistence/Layers/AuthPairingLinks.ts` looks them up
  by value) and the pairing link list returns them (`AuthPairingLink.credential`), so anyone who
  can read the list can pair.
- `docs/REMOTE.md` predates the current policy.

## Concepts

**Environment.** One Glade server and its durable state. Its `environmentId` is created once,
written atomically, and survives restarts, port changes and address changes. Clients identify a
machine by this id, never by an address.

**Route.** One way to reach an environment: `{ kind, url }` with kind `lan`, `vpn`, `tailnet`,
`tailnet-https` or `public-url`. Routes are reachability hints. Only the connecting device can prove
a route works, and a route must answer as the expected environment before it receives a credential.
Loopback is never a route for another device.

**Pairing grant.** A one-time, short-lived secret that delegates a fixed set of permissions. Spent
on first use. Stored hashed. Only its creation response contains the secret.

**Session.** What a paired device holds afterwards. Cookie for browsers, bearer token for apps (and
a proof-of-possession binding later, see below). Lists, revokes and expiry work the same for all
methods.

**Permissions.** Each session carries scopes; each RPC and HTTP route declares the scope it needs.

## Design

### 1. Environment identity and descriptor

- Keep the existing `environmentId` file, written atomically and read once at startup.
- Add an unauthenticated descriptor endpoint (`GET /.well-known/glade/environment`) returning
  `environmentId`, label, server version, protocol version, capabilities and supported auth
  methods. It reveals nothing else. Clients call it on every route before sending a credential,
  so a stale LAN address that now belongs to another machine never sees a token.
- Clients rely on advertised capabilities, not on their own version, because servers on hosts can
  be older or newer than the client.

### 2. Exposure on the desktop

- **Settings → Remote access**, off by default. Turning it on restarts only the backend, not the
  app, with remote binding enabled. Turning it off restores loopback-only and leaves sessions
  intact but unreachable.
- The backend binds a wildcard address and accepts connections only when the socket's local
  address is loopback or private: RFC 1918, IPv6 ULA, link-local and the CGNAT range Tailscale
  uses. Binding a wildcard keeps working when the machine changes Wi-Fi or a VPN comes up, without
  a restart. Public addresses are refused at accept time.
- **Plain HTTP** on LAN or VPN requires a one-time acknowledgement in Settings, worded plainly:
  traffic is unencrypted on networks you don't trust. This maps to the existing
  `allow-insecure-remote` policy.
- **Tailscale HTTPS**: when the `tailscale` CLI is installed and signed in, offer a toggle that
  runs `tailscale serve --bg` for the backend port and records that Glade owns the mapping. Turning
  it off removes only a mapping Glade created. The CLI is resolved through the shared executable
  resolution so Windows paths work.
- **User HTTPS URL**: an optional field for a URL the user already proxies to this machine (their
  domain, reverse proxy). Must be HTTPS.
- When Remote access is on, Settings suggests the existing keep-awake setting, since a sleeping
  machine drops every device.
- Windows shows a firewall prompt on first remote bind; document it.

### 3. Routes the server reports

- An authenticated endpoint returns the environment's current shareable routes: LAN and VPN
  interface addresses, tailnet address, tailnet HTTPS URL and user HTTPS URL, ordered by
  preference (HTTPS first, then direct addresses). Never loopback.
- Interfaces are read with `os.networkInterfaces()` on every platform. Kinds are labelled from the
  address range and interface name; the label is for display only.
- Clients save these as **learned routes**. A learned route that the server stops reporting is
  dropped, which is how a changed LAN address replaces the old one. Routes the user added by hand
  are never dropped.

### 4. Pairing

- Pairing secrets are stored as a hash and looked up by hash. The list of pairing grants returns
  metadata only; the secret appears once, in the creation response. A migration replaces stored
  plaintext secrets; unspent grants live for minutes, so dropping their plaintext loses nothing a
  user relies on.
- Owners create pairing grants (default: standard client permissions, 5 minutes, one use). Creating
  a grant needs the access-management permission and every permission it delegates; a grant can
  never widen authority.
- The QR code encodes one URL:
  `https://<best-route>/pair#v=1&env=<environmentId>&secret=<secret>&routes=<encoded route list>`.
  The secret and the route list live in the fragment, so they never reach a server log or another
  origin. A browser opens the first route; an app reads the whole list. After the exchange the
  client removes the fragment from history.
- Exchange: the client checks the descriptor on the route, then posts the secret to get a session.
  The exchange is rate-limited per source address and compares in constant time. A failed or
  replayed secret consumes nothing else.
- Where pairing is started:
  - **Desktop host**: Settings → Remote access → Pair a device, which shows the QR code.
  - **SSH host**: "Pair a device" in the host's menu in Settings → SSH hosts. The desktop asks the
    host's server, over the existing tunnel and its owner session, to mint a grant, and shows the
    QR code locally. The device then connects to the host directly.
  - **Headless server**: `glade pair` prints the QR code in the terminal and refuses to print a
    loopback-only link.
- Pairing the same environment again from the same device replaces that device's saved grant and
  adds any new routes; it does not create a second machine.

### 5. Sessions, permissions and transport

- Authorization is expressed in scopes: `orchestration:read`, `orchestration:operate`,
  `filesystem:read`, `filesystem:write`, `source-control:write`, `settings:write`,
  `providers:manage`, and owner-only `access:write`, `host:control` and `diagnostics:read`. The
  `owner` and `client` roles are named sets of these scopes, so no stored session changes; a
  narrower role (for example view-only) is a new preset, not a new mechanism.
- Every RPC and HTTP route declares its scope in one table; a middleware checks it before any
  handler runs. A route without a declaration fails closed. Unknown scopes in a request are
  dropped; a request left with no scopes fails before spending a grant.
- Browsers authenticate the WebSocket upgrade with their cookie. Bearer clients fetch a short-lived
  WebSocket ticket over authenticated HTTP, so long-lived tokens never appear in socket URLs. The
  existing `ws-token` route becomes this ticket.
- Session list in Settings → Remote access → Devices: label, device kind, last seen, route last
  used, permissions, revoke, and revoke all others. Pairing grants show metadata only, never the
  secret.
- **Proof of possession (DPoP)** for app clients is designed in now and built with the mobile
  client: the contract reserves the session method, and a token bound to a key never falls back to
  bearer when its proof fails.
- Never log pairing URLs, secrets, session tokens or tickets.

### 6. Client connection runtime

The piece a future mobile client reuses. It is plain TypeScript with no DOM, React or Electron
imports, and lives with the web environments code until a second app needs it; it moves to a shared
package when the mobile client starts.

- **Saved environment catalog** per device: `environmentId`, label, ordered routes (saved and
  learned), and a credential reference. Credentials are stored outside plain files: Electron
  `safeStorage` on desktop, the platform keychain on mobile.
- **Route walk**: check each route's descriptor, connect over the first route that answers as this
  environment and accepts the credential. A route that fails moves on to the next; a server that
  is incompatible stops the walk, since it is the same server on every route.
- **Supervisor**: while connected over a later route, re-check earlier routes on network change,
  app foreground and every minute, including authorization, and switch when one works. A route
  that keeps failing is held back for a cooldown so a flaky network cannot bounce the connection.
- **Learned routes** are refreshed from the server on each connection.
- The renderer's existing multi-environment layer consumes this runtime, so a paired environment
  shows up next to local and SSH host projects with the same picker, status dots and routing.

### 7. Desktop as a remote client

Another computer's Glade can pair with this machine: **Add environment** accepts a pairing link or
QR image. The result is an environment like an SSH host, shown in the same sidebar, pickers and
Settings list. This gives the protocol a real client today and is the exact path a mobile client
will follow.

## Phases

Each phase ships on its own, with docs and a changelog entry.

1. **Server foundation.** Descriptor endpoint, pairing hardening (hashed secrets, metadata-only
   list, rate limits, single use), scopes with declared RPC authorization. WebSocket tickets for
   bearer clients already exist. The shareable routes endpoint moves to phase 2, where the server
   knows how it is exposed.
2. **Desktop exposure.** Remote access setting, backend restart with remote binding, private-address
   accept filter, plain-HTTP acknowledgement, Tailscale HTTPS toggle, user HTTPS URL, pair-a-device
   QR, Devices list with revoke.
3. **Hosts and headless servers.** `glade pair` CLI and "Pair a device" for SSH hosts.
4. **Client runtime and desktop as a client.** Saved catalog, route walk, supervisor, learned
   routes, Add environment.
5. **Mobile client (later, separate plan).** DPoP binding, moving the runtime to a shared package,
   the app itself, and notifications.

## Tests

Access control and pairing are trust boundaries, so they get tests at the HTTP and WebSocket
boundary:

- a declared scope is enforced for every RPC, and an undeclared RPC is rejected;
- a pairing grant works once, expires, cannot widen permissions, is stored only as a hash and is
  never readable after creation;
- a revoked session loses its socket and cannot get a ticket;
- a public local address is refused while private ones are accepted;
- a route that answers with another `environmentId` never receives a credential;
- pending pairing links keep working across the secret-hashing migration.

Exposure, Tailscale and pairing UI are verified in the running app against a phone and the home
server, not with UI tests.

## Docs to update

Rewrite `docs/REMOTE.md` around this model, and update `docs/glade-feature-scope.md`,
`docs/transport.md`, `docs/ssh-hosts.md` (pairing a device with a host) and `CHANGELOG.md`.

## Open questions

- **Notifications without a relay.** Native push (APNs, FCM) needs a sender holding the app's push
  keys; a user's machine cannot hold them safely. Options for the mobile phase: no push, push only
  while the app is connected in the background, or a push service. Decide with the mobile plan.
- **Remote access default port.** Reuse the backend's dynamic port, which changes routes on
  restart, or reserve a stable port when Remote access is on. A stable port keeps saved routes
  valid; leaning toward a stable port with fallback.
- **Self-signed TLS with certificate pinning** for plain LAN and VPN routes would give app clients
  encryption without Tailscale. Valuable only with the mobile client; the pairing payload keeps an
  optional certificate fingerprint field so it can be added without a format change.
