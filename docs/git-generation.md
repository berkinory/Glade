# Git generation

Source Control Generate Message reads the current staged selection, including partial staging. When the index is empty, it describes all current Changes without staging them. Environment actions explicitly stage their intended selection before using the same server generator. A manually entered message bypasses AI generation.

Git writing routes through the provider registered for the selected model. The settings picker reads the server's supported providers rather than maintaining a separate list. Each provider runs an isolated, tool-free structured-output request against the same prompts and result schemas. A disabled or unsupported selection fails explicitly; it never switches providers behind the user's back.

Generation retains the complete patch for small changes. Large changes use a streamed inventory of every changed path, bounded groups and representative paths, then deterministic content samples. Configurations, migrations and dependency changes receive priority. Very large files are represented by status and size without materializing their patch. Omitted evidence is marked, and metadata-only claims must stay within what paths and statuses demonstrate.

Commit content is capped at 20 KB and PR content at 32 KB. The total prompts have separate 32 KB and 48 KB ceilings. UTF-8 bytes provide a conservative token upper bound; Codex additionally uses its model catalog or explicit context-window configuration to restrict that budget, reserving space for the wrapper, schema and output. Missing Codex model limits fail with an actionable discovery error. Repository PR templates and structured output remain in use.

The server checks every path's fingerprint again after generation. Source Control carries that fingerprint through the transport binding and rejects changed index/content before committing an unchanged generated message. Explicit staging remains owned by the commit controls. Failures preserve the draft and existing selection, and automatic actions never substitute a heuristic message after provider failure. Diagnostics record the stage, model, correlation reference and bounded context metrics without patches or prompt contents.

Concurrent requests for the same snapshot share a bounded, short-lived successful generation. Compression is local; there is one provider request per generation, not one per file.

PR discovery, association, creation and checkout remain available. Environment and the conditional sidebar thread icon open PR URLs externally. Dedicated detail/review/code panels and management actions are retired. Existing saved links remain readable.

When a commit/push/PR action includes a title but no separate commit message, that title
also supplies the commit subject. An explicit commit message always takes precedence.
Supplying both PR title and body avoids PR text generation; missing text still uses the
selected provider. Codex generation distinguishes terminal authentication rejection
from recoverable transport fallback warnings. Output collection is bounded and UTF-8
chunk boundaries are preserved; scoped teardown still completes before returning.

Git action progress and failures belong to the captured action, including after
workspace navigation. Failure messages identify the failed phase and preserve the
server's detail. Earlier successful steps are not retried automatically.
