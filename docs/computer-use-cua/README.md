# Computer Use

Glade exposes Computer Use through the bundled Cua driver and the desktop host. The desktop owns the native driver process and forwards scoped requests from active agent sessions. Browser actions use the visible, shared browser surface. The agent gateway validates session ownership, approvals, and tool input before dispatch.

## Supported releases

The release workflow packages the pinned native driver for macOS arm64, macOS x64 and Linux x64. Windows ships without the Cua native driver; the rest of the desktop app remains available. The exact driver source revision, local patch checksums, Rust version, and protocol revision live in [`cuaDriverRelease.json`](../../packages/shared/src/cuaDriverRelease.json). Provisioning and packaged-build validation run through [`provision-cua-driver.mjs`](../../apps/desktop/scripts/provision-cua-driver.mjs).

The local patches are in [`apps/desktop/patches/cua-driver`](../../apps/desktop/patches/cua-driver/README.md). The driver's redistributed license and attribution are preserved in [`CUA-LICENSE.txt`](./CUA-LICENSE.txt). [`import-provenance.json`](./import-provenance.json) is the historical import ledger; some recorded paths have since been retired.

## Permissions and control

On macOS, the signed Glade application needs Accessibility, Screen Recording, and Input Monitoring grants. The bundled computer helper checks them. [Permission guide](./permission-guide.md) describes the setup path. A permission grant alone never starts an agent action: explicit invocation or the enabled Computer control setting, active session ownership, and applicable approvals are still required.

The chat Stop control cancels the active task and native input lease. Foreground use requires an explicit request. If target ownership, focus, or delivery cannot be proved, the driver refuses the action rather than silently replaying it through a different actuator. A hidden preview does not stop a task; Stop does.

## Verification

Run the relevant desktop, shared-contract, and server tests before changing the driver protocol or host lifecycle. The Linux and macOS native workflows check their respective driver targets. A local unsigned Electron launch does not validate macOS permission behavior for the signed release identity; verify grants and app startup using the packaged application.
