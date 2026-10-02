# Git generation

Source Control Generate Message reads the current staged selection, including partial staging. When the index is empty, it describes all current Changes without staging them. Environment actions explicitly stage their intended selection before using the same server generator. A manually entered message bypasses AI generation.

Generation retains the complete patch for small changes. Large changes use a streamed inventory of every changed path, bounded groups and representative paths, then deterministic content samples. Configurations, migrations and dependency changes receive priority. Very large files are represented by status and size without materializing their patch. Omitted evidence is marked, and metadata-only claims must stay within what paths and statuses demonstrate.

Commit content is capped at 20 KB and PR content at 32 KB. The total prompts have separate 32 KB and 48 KB ceilings. UTF-8 bytes provide a conservative token upper bound; the Codex model catalog or explicit context-window configuration further restricts that budget, reserving space for the wrapper, schema and output. Missing model limits fail with an actionable discovery error. Repository PR templates and structured output remain in use.

The server checks every path's fingerprint again after generation. Source Control carries that fingerprint through the transport binding and rejects changed index/content before committing an unchanged generated message. Explicit staging remains owned by the commit controls. Failures preserve the draft and existing selection, and automatic actions never substitute a heuristic message after provider failure. Diagnostics record the stage, model, correlation reference and bounded context metrics without patches or prompt contents.

Concurrent requests for the same snapshot share a bounded, short-lived successful generation. Compression is local; there is one provider request per generation, not one per file.

PR discovery, association, creation and checkout remain available. Environment and the conditional sidebar thread icon open PR URLs externally. Dedicated detail/review/code panels and management actions are retired. Existing saved links remain readable.
