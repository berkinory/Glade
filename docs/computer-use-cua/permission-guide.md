# Computer permission guide

The desktop owns permission checks through the bundled `glade-computer-helper`.
Computer requires Accessibility, Screen Recording and Input Monitoring. The last
scope supports Escape and physical-input takeover; checks never enable automation.

Explicit setup requests check the running application bundle and guide each missing
scope through System Settings. Already granted scopes are skipped. Passive refresh
checks grants without raising OS prompts. Fresh helper processes avoid long-lived
macOS permission caches. Setup cancellation, disposal and generation checks prevent
late responses from reopening a dismissed guide.

The renderer uses `desktopBridge.computerPermissions`; the desktop validates callers
at IPC and the helper protocol validates received messages. Setup errors remain
visible until an explicit retry; a grant notification is not permission to run a task.

The React settings and chat setup surfaces share `ComputerPermissionSection` and
`ComputerPermissionGuide`. The native helper is built by
`apps/desktop/scripts/build-computer-helper.mjs`. Live grant changes require checking
the actual signed app identity, not an unrelated Electron executable.
