# Glade Cua patches

`0001-glade-native.patch` and `0002-glade-linux-browser.patch` apply to the exact upstream source pinned in [`cuaDriverRelease.json`](../../../../packages/shared/src/computer/cuaDriverRelease.json). That manifest records the source commit, checksums, Rust version, and protocol revision. [`provision-cua-driver.mjs`](../../scripts/provision-cua-driver.mjs) verifies those inputs before building or accepting a cached artifact. Do not edit a patch without updating its recorded checksum and validating the resulting driver on its target platform.

The native patch owns exact-target input admission, cancellation, held-input release, focus restoration, and the embedded host lifecycle. It does not replay an uncertain mutation through another actuator. The Linux patch is limited to its browser path. The driver SDK is built as an `rlib`; no separate SDK `cdylib` ships with Glade.

The original Cua implementation and contributor attribution remain under [`CUA-LICENSE.txt`](../../../../docs/computer-use-cua/CUA-LICENSE.txt). See the [Computer Use guide](../../../../docs/computer-use-cua/README.md) for supported releases, permissions, and verification boundaries.
