# Diagnostics

Glade does not start a desktop telemetry or crash-upload sender. Dev and Prod have
no Beta diagnostics channel or endpoint configuration.

Local logs and task diagnostics remain available for troubleshooting. Review and
redact them before sharing. The feedback action opens a GitHub issue draft for
manual review; it does not silently upload a report.

See [product scope](glade-feature-scope.md) for the removed surfaces and retained
shared functionality. Upstream diagnostic implementation files remain inert for
rebase compatibility.
