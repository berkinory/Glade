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

## MCP artwork

Tool rows and the plugin library share `serviceBrandArtwork.ts`. MCP icons are
selected from explicit app metadata, a qualified `mcp__server__tool` name, or a
separate server identity. Connector tool prefixes are used only within the
`codex_apps` namespace. Unknown MCPs retain `McpServerIcon`; generic tool approval
requests use `ToolsIcon`. Glade and Computer tools retain their dedicated icons.

Local artwork is used without runtime image downloads. The selected MCP services
include Context7, Exa, Firecrawl, Playwright, Chrome DevTools,
Browserbase, Supabase, Cloudflare, AWS, Railway, Convex, Atlassian, Sentry,
Datadog, PostHog, n8n, Blender, Penpot, Draw.io, Excalidraw, Cal.com, Notion,
Stripe, Shopify, Brave Search, Paper, and pen.dev.

Paper uses the `paper` server identity described in [Paper's MCP docs](https://paper.design/docs/mcp).
pen.dev also recognizes `pencil`, its documented server name in
[the integration guide](https://docs.pen.dev/getting-started/ai-integration).

| Component            | Asset                | Source                                                            |
| -------------------- | -------------------- | ----------------------------------------------------------------- |
| `Context7Icon`       | `context7.png`       | [Context7](https://context7.com/context7-icon-green.png)          |
| `ExaIcon`            | `exa.png`            | [Exa](https://exa.ai/images/favicon-32x32.png)                    |
| `BrowserbaseIcon`    | `browserbase.svg`    | [Browserbase](https://www.browserbase.com/favicon.svg)            |
| `PenDevIcon`         | `pendev.png`         | [pen.dev](https://pen.dev/favicon-96x96.png)                      |
| `FirecrawlIcon`      | `firecrawl.svg`      | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `PlaywrightIcon`     | `playwright.svg`     | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `ChromeDevToolsIcon` | `chrome.svg`         | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `SupabaseIcon`       | `supabase.svg`       | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `CloudflareIcon`     | `cloudflare.svg`     | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `AwsIcon`            | `aws.svg`            | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `RailwayIcon`        | `railway.svg`        | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `ConvexIcon`         | `convex.svg`         | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `AtlassianIcon`      | `atlassian.svg`      | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `SentryIcon`         | `sentry.svg`         | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `DatadogIcon`        | `datadog.svg`        | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `PostHogIcon`        | `posthog.svg`        | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `N8nIcon`            | `n8n.svg`            | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `BlenderIcon`        | `blender.svg`        | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `PenpotIcon`         | `penpot.svg`         | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `DrawioIcon`         | `diagramsdotnet.svg` | [Simple Icons](https://github.com/simple-icons/simple-icons), CC0 |
| `ExcalidrawIcon`     | `excalidraw.svg`     | [Simple Icons](https://github.com/simple-icons/simple-icons), CC0 |
| `CalComIcon`         | `calcom.svg`         | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `ShopifyIcon`        | `shopify.svg`        | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `BraveSearchIcon`    | `brave.svg`          | [SVGL](https://github.com/pheralb/svgl), MIT                      |
| `PaperIcon`          | `paper.svg`          | [SVGL](https://github.com/pheralb/svgl), MIT                      |

Simple Icons artwork is distributed under CC0; its license is retained in
[licenses/icons/SIMPLE-ICONS-LICENSE.txt](licenses/icons/SIMPLE-ICONS-LICENSE.txt).
Official-site artwork retains the respective owner’s rights.

## Additional official MCP services

These services have first-party MCP support. Artwork is stored locally and optimized before use. SVGs are minified with SVGO; PNGs are losslessly compressed. Monochrome marks follow the UI text color. Azure DevOps uses the Azure artwork; Upstash Redis uses the Upstash artwork.

| Service                | Component             | Asset source                                                                                                   | Official MCP documentation                                                                             | Bytes |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| Neon                   | `NeonIcon`            | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/neon.svg)                      | [MCP docs](https://neon.com/docs/ai/neon-mcp-server)                                                   | 247   |
| MongoDB                | `MongoDBIcon`         | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/mongodb-icon-dark.svg)         | [MCP docs](https://www.mongodb.com/docs/mcp-server/)                                                   | 503   |
| Grafana                | `GrafanaIcon`         | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/grafana.svg)                   | [MCP docs](https://grafana.com/docs/grafana/latest/developer-resources/mcp/)                           | 5587  |
| Axiom                  | `AxiomIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/axiom-light.svg)               | [MCP docs](https://axiom.co/docs/console/intelligence/mcp-server)                                      | 913   |
| PlanetScale            | `PlanetScaleIcon`     | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/planetscale.svg)               | [MCP docs](https://planetscale.com/docs/connect/mcp)                                                   | 248   |
| Turso                  | `TursoIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/turso-light.svg)               | [MCP docs](https://docs.turso.tech/integrations/mcp)                                                   | 823   |
| Clerk                  | `ClerkIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/clerk-icon-light.svg)          | [MCP docs](https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server)                                      | 796   |
| Prisma                 | `PrismaIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/prisma.svg)                    | [MCP docs](https://www.prisma.io/docs/ai/tools/mcp-server)                                             | 540   |
| Resend                 | `ResendIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/resend-icon-black.svg)         | [MCP docs](https://resend.com/docs/mcp-server)                                                         | 455   |
| Sanity                 | `SanityIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/sanity-light.svg)              | [MCP docs](https://www.sanity.io/docs/ai/mcp-server)                                                   | 672   |
| GitLab                 | `GitLabIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/gitlab.svg)                    | [MCP docs](https://docs.gitlab.com/user/model_context_protocol/mcp_server/)                            | 836   |
| Azure                  | `AzureIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/azure.svg)                     | [MCP docs](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/)                        | 1569  |
| JetBrains              | `JetBrainsIcon`       | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/jetbrains.svg)                 | [MCP docs](https://www.jetbrains.com/help/idea/mcp-server.html)                                        | 2513  |
| Firebase               | `FirebaseIcon`        | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/firebase.svg)                  | [MCP docs](https://firebase.google.com/docs/ai-assistance/mcp-server)                                  | 1188  |
| Netlify                | `NetlifyIcon`         | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/netlify.svg)                   | [MCP docs](https://docs.netlify.com/build/build-with-ai/netlify-mcp-server)                            | 912   |
| Render                 | `RenderIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/render_black.svg)              | [MCP docs](https://render.com/docs/mcp-server)                                                         | 1608  |
| Redis                  | `RedisIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/redis.svg)                     | [MCP docs](https://redis.io/docs/latest/integrate/redis-mcp/)                                          | 1841  |
| Auth0                  | `Auth0Icon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/auth0.svg)                     | [MCP docs](https://auth0.com/docs/get-started/auth0-mcp-server)                                        | 333   |
| Perplexity             | `PerplexityIcon`      | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/perplexity.svg)                | [MCP docs](https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server)                    | 531   |
| Asana                  | `AsanaIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/asana-logo.svg)                | [MCP docs](https://developers.asana.com/docs/mcp-server)                                               | 554   |
| Trello                 | `TrelloIcon`          | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/trello.svg)                    | [MCP docs](https://support.atlassian.com/trello/docs/connect-trello-to-ai-assistants-with-trello-mcp/) | 609   |
| Databuddy              | `DatabuddyIcon`       | [Official site](https://www.databuddy.cc/icon0.svg)                                                            | [MCP docs](https://www.databuddy.cc/docs/api/mcp)                                                      | 4084  |
| Umami                  | `UmamiIcon`           | [Official site](https://umami.is/safari-pinned-tab.svg)                                                        | [MCP docs](https://docs.umami.is/docs/mcp)                                                             | 1404  |
| fal.ai                 | `FalAiIcon`           | [Official site](https://fal.ai/favicon.png)                                                                    | [MCP docs](https://fal.ai/docs/documentation/setting-up/mcp)                                           | 677   |
| Upstash                | `UpstashIcon`         | [Official site](https://upstash.com/icons/favicon-32x32.png)                                                   | [MCP docs](https://upstash.com/docs/agent-resources/mcp)                                               | 1092  |
| ClickHouse             | `ClickHouseIcon`      | [Official site](https://clickhouse.com/icon0.svg)                                                              | [MCP docs](https://clickhouse.com/docs/cloud/features/ai-ml/remote-mcp)                                | 433   |
| Tavily                 | `TavilyIcon`          | [Official site](https://tavily.com/icon.svg)                                                                   | [MCP docs](https://docs.tavily.com/documentation/mcp)                                                  | 1269  |
| Zapier                 | `ZapierIcon`          | [Simple Icons (CC0)](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/zapier.svg)     | [MCP docs](https://docs.zapier.com/mcp/home)                                                           | 2572  |
| ElevenLabs             | `ElevenLabsIcon`      | [Simple Icons (CC0)](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/elevenlabs.svg) | [MCP docs](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp)                                | 142   |
| 1Password              | `OnePasswordIcon`     | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/1password-light.svg)           | [MCP docs](https://www.1password.dev/environments/mcp-server)                                          | 1138  |
| OpenRouter             | `OpenRouterIcon`      | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/openrouter_light.svg)          | [MCP docs](https://openrouter.ai/docs/guides/overview/mcp-server)                                      | 467   |
| tldraw                 | `TldrawIcon`          | [Official site](https://www.tldraw.com/favicon.svg)                                                            | [MCP docs](https://github.com/tldraw/tldraw/blob/main/apps/mcp-app/README.md)                          | 837   |
| Amplitude              | `AmplitudeIcon`       | [Official site](https://amplitude.com/nextjs-public/favicon/favicon-32x32.png)                                 | [MCP docs](https://amplitude.com/docs/en/amplitude-ai/amplitude-mcp)                                   | 1451  |
| Mixpanel               | `MixpanelIcon`        | [Official site (Mixpanel favicon)](https://framerusercontent.com/images/LQGlUOsWA5MZ1jvvodsRAoGkNw.svg)        | [MCP docs](https://docs.mixpanel.com/docs/mcp)                                                         | 1036  |
| Google Analytics / GA4 | `GoogleAnalyticsIcon` | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/google-analytics.svg)          | [MCP docs](https://developers.google.com/analytics/devguides/MCP)                                      | 673   |
| Filesystem             | `Folder02Icon`        | [Existing Hugeicons Folder02Icon](https://www.npmjs.com/package/@hugeicons/core-free-icons)                    | [MCP docs](https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/README.md)         | 0     |
| Intercom               | `IntercomIcon`        | [Official site](https://www.intercom.com/intercom-marketing-site/favicons/favicon-32x32.png)                   | [MCP docs](https://developers.intercom.com/docs/guides/mcp)                                            | 1207  |
| Miro                   | `MiroIcon`            | [Official site](https://framerusercontent.com/images/6FBG66PBxjV2QFaDfIdUi5mi9A.png)                           | [MCP docs](https://developers.miro.com/docs/miro-mcp)                                                  | 700   |
| Granola                | `GranolaIcon`         | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/granola-light.svg)             | [MCP docs](https://www.granola.ai/mcp)                                                                 | 2880  |
| Docusign               | `DocusignIcon`        | [Official site](https://www.docusign.com/assets/images/apple-touch-icon-60x60.png)                             | [MCP docs](https://developers.docusign.com/platform/mcp-server/)                                       | 612   |
| Spotify                | `SpotifyIcon`         | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/spotify.svg)                   | [MCP docs](https://claude.com/connectors/spotify)                                                      | 995   |
| Calendly               | `CalendlyIcon`        | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/calendly.svg)                  | [MCP docs](https://developer.calendly.com/calendly-mcp-server)                                         | 3549  |
| Unity                  | `UnityIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/unity.svg)                     | [MCP docs](https://docs.unity.com/en-us/unity-cli/replace-mcp-server-unity-cli)                        | 367   |
| Superhuman             | `SuperhumanIcon`      | [Official site](https://superhumanstatic.com/super-funnel/main/public/images/v4/favicons/superhuman-icon.svg)  | [MCP docs](https://help.superhuman.com/hc/en-us/articles/46005696690317-Superhuman-Mail-MCP-Server)    | 627   |
| Mercury                | `MercuryIcon`         | [Official site](https://mercury.com/icon.svg)                                                                  | [MCP docs](https://docs.mercury.com/docs/connecting-mercury-mcp)                                       | 6420  |
| Craft                  | `CraftIcon`           | [Official site](https://www.craft.do/favicons/light/light_32.png)                                              | [MCP docs](https://www.craft.do/imagine/guide/mcp/mcp)                                                 | 587   |
| Browser Use            | `BrowserUseIcon`      | [Official site](https://browser-use.com/favicon-32x32.png)                                                     | [MCP docs](https://browser-use.com/mcp)                                                                | 1224  |
| Mintlify               | `MintlifyIcon`        | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/mintlify.svg)                  | [MCP docs](https://www.mintlify.com/docs/ai/model-context-protocol)                                    | 903   |
| OpenStatus             | `OpenStatusIcon`      | [Official site](https://www.openstatus.dev/icon.png)                                                           | [MCP docs](https://www.openstatus.dev/tooling/mcp-server)                                              | 1563  |
| Polar                  | `PolarIcon`           | [SVGL (MIT)](https://raw.githubusercontent.com/pheralb/svgl/main/static/library/polar-sh_light.svg)            | [MCP docs](https://polar.sh/docs/integrate/mcp)                                                        | 1361  |
| Scalar                 | `ScalarIcon`          | [Official site](https://scalar.com/favicon.svg)                                                                | [MCP docs](https://scalar.com/products/agent/mcp)                                                      | 1064  |
| Aside                  | `AsideIcon`           | [Official site](https://aside.com/icon.png)                                                                    | [MCP docs](https://docs.aside.com/help/developers)                                                     | 1185  |
| Better Stack           | `BetterStackIcon`     | [Official site](https://betterstack.com/assets/favicon-64296699.png)                                           | [MCP docs](https://betterstack.com/docs/getting-started/integrations/mcp/)                             | 3256  |
| Executor               | `ExecutorIcon`        | [Official site](https://executor.sh/favicon-32.png)                                                            | [MCP docs](https://executor.sh/docs/mcp-proxy)                                                         | 1168  |
| Astro ASO              | `AstroAsoIcon`        | [Official site](https://tryastro.app/favicon.ico)                                                              | [MCP release notes](https://tryastro.app/release_notes/)                                               | 802   |
| Mobbin                 | `MobbinIcon`          | [Official site](https://mobbin.com/mobbin-marketing-pages/images/favicon.svg)                                  | [MCP docs](https://mobbin.com/mcp)                                                                     | 789   |

Azure DevOps has a separate [official Microsoft MCP implementation](https://github.com/microsoft/azure-devops-mcp). Umami MCP requires self-hosted v3.4.0 or later, or a supported Umami Cloud plan. Clerk MCP is currently beta. Databuddy’s light/dark duplicate artwork is reduced to one compound path with transparent interior details.

Proton Pass artwork is not registered: its official developer documentation currently describes CLI and agent tokens, while the available Proton Pass MCP implementation is a community project. A session provider does not establish MCP ownership. Unknown MCPs remain generic; provider logos are not inferred from the session provider or arbitrary server names.

Filesystem is the MCP steering group’s reference server. It uses the existing `Folder02Icon` glyph instead of a brand asset. The official Google Analytics server’s documented `analytics-mcp` identity and `ga4` alias share the Google Analytics logo. tldraw exposes an MCP App; this icon mapping does not add MCP App canvas support to Glade.

Umami’s official implementation is present in [the main repository](https://github.com/umami-software/umami/tree/master/src/app/mcp) and published as [`@umami/mcp`](https://www.npmjs.com/package/@umami/mcp). Community Umami implementations are separate projects; this mapping is based on the official support.

Unity artwork recognizes the supported Unity CLI MCP mode, not only the deprecated in-editor server. Spotify support is based on Spotify’s first-party connector listed by Anthropic. Ollama, Obsidian and Pinterest are not registered because a public first-party MCP server was not verified. Astro refers to the ASO application at tryastro.app, not the Astro web framework. Astro and Mobbin favicon artwork is stored as small PNGs. Mobbin follows the UI text color; Astro retains its two-tone mark.

Executor is handled as an ordinary MCP server and receives its own logo. Upstream integrations, authentication and policies belong to Executor. Glade does not unpack calls hidden inside Executor’s code execution into separate work entries or infer their brands. Local setup supports HTTP (`http://127.0.0.1:4788/mcp`) or stdio (`executor mcp`); hosted endpoints come from the Executor connection UI.
