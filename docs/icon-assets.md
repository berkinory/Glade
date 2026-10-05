# Icon assets

UI icons use `@hugeicons/core-free-icons` through `apps/web/src/lib/icons.tsx`. Import the canonical Hugeicons component name from that module. Core glyphs use the package’s per-icon exports so development and production load only the selected artwork. The factory supplies intrinsic dimensions, stroke and accessible-label behavior without forcing a CSS size; the owning control sets the glyph size. Filled variants are distinct components only where a control needs that state.

Sidebar row icons share `SidebarLeadingIcon` and the leading glyph rule in `sidebarGlyphs.tsx`. The icon, its slot and its optical alignment scale together with app typography; settings, project and provider rows use that same rule. Labeled buttons, menus, badges, activity metadata and environment rows use font-relative glyph sizes. Icon-only controls and overlay badges retain their control-specific sizes. `SearchInput` scales its icon and text inset with typography. Labeled dock/workspace chips scale their glyphs, icon slots and close glyphs with the secondary UI text. Inline chips align their glyphs to the text baseline without a fixed vertical translation.

Brand artwork uses `apps/web/src/lib/brandIcons.tsx` and static vectors under `apps/web/public/brands`. Monochrome marks inherit the surrounding text color; multicolor marks retain their artwork. OpenAI uses a tightly cropped vector in `apps/web/src/assets/brands/openai.svg`, imported through Vite so artwork changes produce a new URL instead of retaining a cached image. Keep brand assets local and retain source attribution.

File and folder icons continue to use the Symbols theme in `apps/web/src/file-icons.ts` and `apps/web/public/symbols`; they are independent of UI and brand icons. Project and space icon keys are persisted data. `apps/web/src/lib/namedIcons.tsx` maps those stable keys to the canonical UI components without rewriting stored selections. Other UI configuration should store icon components, not string keys.

Hugeicons core 4.3.5 and React 1.1.10 are MIT licensed. SVGL artwork was obtained from [SVGL](https://github.com/pheralb/svgl); the repository is MIT licensed. Android Studio, CLion, DataGrip and Xcode colored marks come from [Devicon](https://github.com/devicons/devicon). License copies are in [licenses/icons](licenses/icons). Marks remain the property of their respective owners.

iTerm2 preserves the original vector with a dark terminal, gray frame and green prompt. Its source was the [Simple Icons contribution](https://github.com/simple-icons/simple-icons/pull/6325). GoLand preserves the existing Simple Icons vector, distributed under [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md). Notion uses the supplied custom vector; Terminal uses Glade’s existing custom artwork. Glade app artwork and the native Finder image retain their existing sources.

## Brand inventory

| Component            | Asset                        | Source                                  |
| -------------------- | ---------------------------- | --------------------------------------- |
| `AndroidStudioIcon`  | `androidstudio-original.svg` | custom svg / androidstudio-original.svg |
| `ClaudeIcon`         | `claude-ai-icon.svg`         | svgl / claude-ai-icon.svg               |
| `CLionIcon`          | `clion-original.svg`         | custom svg / clion-original.svg         |
| `CursorIcon`         | `cursor_light.svg`           | svgl / cursor_light.svg                 |
| `DataGripIcon`       | `datagrip-original.svg`      | custom svg / datagrip-original.svg      |
| `LinkedInIcon`       | `linkedin.svg`               | svgl / linkedin.svg                     |
| `GhosttyIcon`        | `ghostty.svg`                | svgl / ghostty.svg                      |
| `GitHubIcon`         | `github_light.svg`           | svgl / github_light.svg                 |
| `GoLandIcon`         | `goland.svg`                 | custom svg · mevcut çizim korunur       |
| `IntelliJIdeaIcon`   | `intellijidea.svg`           | svgl / intellijidea.svg                 |
| `Iterm2Icon`         | `iterm2-color.svg`           | custom svg / iterm2-color.svg           |
| `OpenAIIcon`         | `openai.svg`                 | svgl / openai.svg, cropped viewBox      |
| `PhpStormIcon`       | `phpstorm.svg`               | svgl / phpstorm.svg                     |
| `PyCharmIcon`        | `pycharm.svg`                | svgl / pycharm.svg                      |
| `RiderIcon`          | `rider.svg`                  | svgl / rider.svg                        |
| `RubyMineIcon`       | `rubymine.svg`               | svgl / rubymine.svg                     |
| `CanvaIcon`          | `canva.svg`                  | svgl / canva.svg                        |
| `FigmaIcon`          | `figma.svg`                  | svgl / figma.svg                        |
| `GmailIcon`          | `gmail.svg`                  | svgl / gmail.svg                        |
| `GoogleCalendarIcon` | `google-calendar.svg`        | svgl / google-calendar.svg              |
| `GoogleDriveIcon`    | `drive.svg`                  | svgl / drive.svg                        |
| `HuggingFaceIcon`    | `hugging_face.svg`           | svgl / hugging_face.svg                 |
| `LinearIcon`         | `linear.svg`                 | svgl / linear.svg                       |
| `NotionIcon`         | `notion.svg`                 | custom svg / Notion                     |
| `RedditIcon`         | `reddit.svg`                 | svgl / reddit.svg                       |
| `SlackIcon`          | `slack.svg`                  | svgl / slack.svg                        |
| `StripeIcon`         | `stripe.svg`                 | svgl / stripe.svg                       |
| `VercelIcon`         | `vercel.svg`                 | svgl / vercel.svg                       |
| `XBrandIcon`         | `x.svg`                      | svgl / x.svg                            |
| `SublimeTextIcon`    | `sublimetext.svg`            | svgl / sublimetext.svg                  |
| `TerminalAppIcon`    | `terminalapp.svg`            | custom svg · mevcut çizim korunur       |
| `VSCodeIcon`         | `vscode.svg`                 | svgl / vscode.svg                       |
| `VscodiumIcon`       | `vscodium.svg`               | svgl / vscodium.svg                     |
| `WarpIcon`           | `warp.svg`                   | svgl / warp.svg                         |
| `WebStormIcon`       | `webstorm.svg`               | svgl / webstorm.svg                     |
| `WindsurfIcon`       | `windsurf-light.svg`         | svgl / windsurf-light.svg               |
| `XcodeIcon`          | `xcode-original.svg`         | custom svg / xcode-original.svg         |
| `ZedIcon`            | `zed-logo.svg`               | svgl / zed-logo.svg                     |
