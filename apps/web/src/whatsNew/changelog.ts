import changelogMarkdown from "../../../../CHANGELOG.md?raw";

import { parseChangelog } from "./logic";

export const CHANGELOG_ENTRIES = parseChangelog(changelogMarkdown);
