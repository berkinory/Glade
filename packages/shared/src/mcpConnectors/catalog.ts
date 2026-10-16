// Every preset was checked against its live server: "none" servers answer without credentials,
// "oauth" servers accepted Glade's client metadata document or a dynamic client registration with
// its loopback redirect, and
// "token" servers take a bearer token. Vendors that need a pre-registered OAuth app are left out.
export type McpConnectorPresetAuth = "none" | "oauth" | "token";

export type McpConnectorCategory =
  | "docs"
  | "data"
  | "infrastructure"
  | "observability"
  | "ai"
  | "design"
  | "work"
  | "business";

export interface McpConnectorPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  // The vendor's site; its favicon is the preset's icon.
  readonly homepage: string;
  readonly category: McpConnectorCategory;
  readonly auth: McpConnectorPresetAuth;
  // Where the user creates a token: required for "token" presets; on "none" presets it marks an
  // optional key the server accepts, typically for higher limits.
  readonly tokenUrl?: string;
}

export const MCP_CONNECTOR_CATEGORIES: ReadonlyArray<{
  readonly id: McpConnectorCategory;
  readonly label: string;
}> = [
  { id: "docs", label: "Docs & knowledge" },
  { id: "data", label: "Databases" },
  { id: "infrastructure", label: "Code & infrastructure" },
  { id: "observability", label: "Monitoring & analytics" },
  { id: "ai", label: "AI & search" },
  { id: "design", label: "Web & design" },
  { id: "work", label: "Projects & notes" },
  { id: "business", label: "Payments & business" },
];

type PresetInput = Omit<McpConnectorPreset, "category" | "auth">;

const shelf = (
  category: McpConnectorCategory,
  auth: McpConnectorPresetAuth,
  presets: ReadonlyArray<PresetInput>,
): ReadonlyArray<McpConnectorPreset> => presets.map((preset) => ({ ...preset, category, auth }));

export const MCP_CONNECTOR_PRESETS: ReadonlyArray<McpConnectorPreset> = [
  ...shelf("docs", "none", [
    {
      id: "context7",
      name: "Context7",
      description: "Current docs and code examples for libraries",
      url: "https://mcp.context7.com/mcp",
      homepage: "https://context7.com",
      tokenUrl: "https://context7.com/dashboard",
    },
    {
      id: "deepwiki",
      name: "DeepWiki",
      description: "Ask questions about public GitHub repositories",
      url: "https://mcp.deepwiki.com/mcp",
      homepage: "https://deepwiki.com",
    },
    {
      id: "exa",
      name: "Exa",
      description: "Web search and page contents",
      url: "https://mcp.exa.ai/mcp",
      homepage: "https://exa.ai",
      tokenUrl: "https://dashboard.exa.ai/api-keys",
    },
    {
      id: "huggingface",
      name: "Hugging Face",
      description: "Models, datasets, Spaces and papers",
      url: "https://huggingface.co/mcp",
      homepage: "https://huggingface.co",
      tokenUrl: "https://huggingface.co/settings/tokens",
    },
    {
      id: "cloudflare-docs",
      name: "Cloudflare Docs",
      description: "Search Cloudflare's developer documentation",
      url: "https://docs.mcp.cloudflare.com/mcp",
      homepage: "https://developers.cloudflare.com",
    },
    {
      id: "microsoft-learn",
      name: "Microsoft Learn",
      description: "Microsoft and Azure documentation",
      url: "https://learn.microsoft.com/api/mcp",
      homepage: "https://learn.microsoft.com",
    },
    {
      id: "openai-docs",
      name: "OpenAI Docs",
      description: "OpenAI API and platform documentation",
      url: "https://developers.openai.com/mcp",
      homepage: "https://developers.openai.com",
    },
    {
      id: "aws-knowledge",
      name: "AWS Knowledge",
      description: "AWS documentation, guidance and regional availability",
      url: "https://knowledge-mcp.global.api.aws",
      homepage: "https://aws.amazon.com",
    },
    {
      id: "auth0-docs",
      name: "Auth0 Docs",
      description: "Search the Auth0 documentation",
      url: "https://auth0.com/docs/mcp",
      homepage: "https://auth0.com",
    },
    {
      id: "svelte",
      name: "Svelte",
      description: "Svelte and SvelteKit documentation",
      url: "https://mcp.svelte.dev/mcp",
      homepage: "https://svelte.dev",
    },
    {
      id: "astro-docs",
      name: "Astro Docs",
      description: "Astro framework documentation",
      url: "https://mcp.docs.astro.build/mcp",
      homepage: "https://astro.build",
    },
    {
      id: "wolfram",
      name: "Wolfram",
      description: "Computation, math and curated data",
      url: "https://agenttools.wolfram.com/mcp",
      homepage: "https://www.wolfram.com",
    },
  ]),
  ...shelf("data", "oauth", [
    {
      id: "supabase",
      name: "Supabase",
      description: "Projects, SQL, migrations and edge functions",
      url: "https://mcp.supabase.com/mcp",
      homepage: "https://supabase.com",
    },
    {
      id: "neon",
      name: "Neon",
      description: "Serverless Postgres projects, branches and queries",
      url: "https://mcp.neon.tech/mcp",
      homepage: "https://neon.com",
    },
    {
      id: "prisma",
      name: "Prisma Postgres",
      description: "Databases, schemas, migrations and backups",
      url: "https://mcp.prisma.io/mcp",
      homepage: "https://www.prisma.io",
    },
    {
      id: "planetscale",
      name: "PlanetScale",
      description: "Databases, branches, schema and Insights",
      url: "https://mcp.pscale.dev/mcp/planetscale",
      homepage: "https://planetscale.com",
    },
    {
      id: "turso",
      name: "Turso",
      description: "Databases, groups and SQL on Turso Cloud",
      url: "https://mcp.turso.ai/mcp",
      homepage: "https://turso.tech",
    },
    {
      id: "clickhouse",
      name: "ClickHouse Cloud",
      description: "Services, queries and analytics data",
      url: "https://mcp.clickhouse.cloud/mcp",
      homepage: "https://clickhouse.com",
    },
    {
      id: "upstash",
      name: "Upstash",
      description: "Redis databases, vector indexes and queues",
      url: "https://mcp.upstash.com/mcp",
      homepage: "https://upstash.com",
    },
    {
      id: "mongodb",
      name: "MongoDB Atlas",
      description: "Clusters, databases and queries",
      url: "https://mcp.mongodb.com/mcp",
      homepage: "https://www.mongodb.com",
    },
  ]),
  ...shelf("infrastructure", "token", [
    {
      id: "github",
      name: "GitHub",
      description: "Repositories, issues, pull requests and Actions",
      url: "https://api.githubcopilot.com/mcp/",
      homepage: "https://github.com",
      tokenUrl: "https://github.com/settings/personal-access-tokens",
    },
    {
      id: "render",
      name: "Render",
      description: "Services, deploys, logs and metrics",
      url: "https://mcp.render.com/mcp",
      homepage: "https://render.com",
      tokenUrl: "https://dashboard.render.com/u/settings#api-keys",
    },
  ]),
  ...shelf("infrastructure", "oauth", [
    {
      id: "cloudflare",
      name: "Cloudflare",
      description: "Workers, storage, DNS and the whole Cloudflare API",
      url: "https://mcp.cloudflare.com/mcp",
      homepage: "https://www.cloudflare.com",
    },
    {
      id: "gitlab",
      name: "GitLab",
      description: "Projects, issues, merge requests and pipelines",
      url: "https://gitlab.com/api/v4/mcp",
      homepage: "https://gitlab.com",
    },
    {
      id: "postman",
      name: "Postman",
      description: "Collections, requests and API workspaces",
      url: "https://mcp.postman.com/mcp",
      homepage: "https://www.postman.com",
    },
    {
      id: "circleci",
      name: "CircleCI",
      description: "Pipelines, builds, test results and logs",
      url: "https://mcp.circleci.com/v1/mcp",
      homepage: "https://circleci.com",
    },
    {
      id: "netlify",
      name: "Netlify",
      description: "Sites, deploys and project settings",
      url: "https://netlify-mcp.netlify.app/mcp",
      homepage: "https://www.netlify.com",
    },
    {
      id: "railway",
      name: "Railway",
      description: "Projects, services, variables and deploys",
      url: "https://mcp.railway.com/",
      homepage: "https://railway.com",
    },
    {
      id: "fly",
      name: "Fly.io",
      description: "Apps, machines and deployments",
      url: "https://mcp.fly.io/mcp",
      homepage: "https://fly.io",
    },
    {
      id: "digitalocean",
      name: "DigitalOcean",
      description: "Apps, droplets, databases and networking",
      url: "https://mcp.digitalocean.com/mcp",
      homepage: "https://www.digitalocean.com",
    },
    {
      id: "heroku",
      name: "Heroku",
      description: "Apps, dynos, add-ons and logs",
      url: "https://mcp.heroku.com/mcp",
      homepage: "https://www.heroku.com",
    },
    {
      id: "pulumi",
      name: "Pulumi",
      description: "Stacks, resources and infrastructure insights",
      url: "https://mcp.ai.pulumi.com/mcp",
      homepage: "https://www.pulumi.com",
    },
    {
      id: "expo",
      name: "Expo",
      description: "EAS builds, submissions and updates",
      url: "https://mcp.expo.dev/mcp",
      homepage: "https://expo.dev",
    },
    {
      id: "hostinger",
      name: "Hostinger",
      description: "Websites, domains, DNS and VPS",
      url: "https://mcp.hostinger.com",
      homepage: "https://www.hostinger.com",
    },
    {
      id: "workos",
      name: "WorkOS",
      description: "Organizations, users, SSO and directory sync",
      url: "https://mcp.workos.com/mcp",
      homepage: "https://workos.com",
    },
    {
      id: "clerk",
      name: "Clerk",
      description: "Users, organizations and authentication",
      url: "https://mcp.clerk.com/mcp",
      homepage: "https://clerk.com",
    },
  ]),
  ...shelf("observability", "oauth", [
    {
      id: "sentry",
      name: "Sentry",
      description: "Issues, errors, traces and releases",
      url: "https://mcp.sentry.dev/mcp",
      homepage: "https://sentry.io",
    },
    {
      id: "posthog",
      name: "PostHog",
      description: "Product analytics, feature flags and experiments",
      url: "https://mcp.posthog.com/mcp",
      homepage: "https://posthog.com",
    },
    {
      id: "datadog",
      name: "Datadog",
      description: "Logs, metrics, traces and monitors",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      homepage: "https://www.datadoghq.com",
    },
    {
      id: "grafana",
      name: "Grafana Cloud",
      description: "Dashboards, metrics, logs and alerts",
      url: "https://mcp.grafana.com/mcp",
      homepage: "https://grafana.com",
    },
    {
      id: "honeycomb",
      name: "Honeycomb",
      description: "Query traces and events",
      url: "https://mcp.honeycomb.io/mcp",
      homepage: "https://www.honeycomb.io",
    },
    {
      id: "axiom",
      name: "Axiom",
      description: "Query logs, traces and events",
      url: "https://mcp.axiom.co/mcp",
      homepage: "https://axiom.co",
    },
    {
      id: "betterstack",
      name: "Better Stack",
      description: "Uptime, incidents, logs and telemetry",
      url: "https://mcp.betterstack.com",
      homepage: "https://betterstack.com",
    },
    {
      id: "amplitude",
      name: "Amplitude",
      description: "Charts, dashboards and experiments",
      url: "https://mcp.amplitude.com/mcp",
      homepage: "https://amplitude.com",
    },
    {
      id: "mixpanel",
      name: "Mixpanel",
      description: "Events, funnels and reports",
      url: "https://mcp.mixpanel.com/mcp",
      homepage: "https://mixpanel.com",
    },
    {
      id: "braintrust",
      name: "Braintrust",
      description: "AI evals, experiments and logs",
      url: "https://api.braintrust.dev/mcp",
      homepage: "https://www.braintrust.dev",
    },
  ]),
  ...shelf("ai", "token", [
    {
      id: "wiro",
      name: "Wiro",
      description: "Run image, video, audio and 3D models",
      url: "https://mcp.wiro.ai/v1",
      homepage: "https://wiro.ai",
      tokenUrl: "https://wiro.ai/panel/project",
    },
  ]),
  ...shelf("ai", "none", [
    {
      id: "firecrawl",
      name: "Firecrawl",
      description: "Search, scrape and parse web pages",
      url: "https://mcp.firecrawl.dev/v2/mcp",
      homepage: "https://www.firecrawl.dev",
      tokenUrl: "https://www.firecrawl.dev/app/api-keys",
    },
  ]),
  ...shelf("ai", "oauth", [
    {
      id: "perplexity",
      name: "Perplexity",
      description: "Search the web with cited answers",
      url: "https://api.perplexity.ai/mcp",
      homepage: "https://www.perplexity.ai",
    },
    {
      id: "tavily",
      name: "Tavily",
      description: "Web search, extraction and crawling",
      url: "https://mcp.tavily.com/mcp/",
      homepage: "https://www.tavily.com",
    },
    {
      id: "brightdata",
      name: "Bright Data",
      description: "Scrape and search the web at scale",
      url: "https://mcp.brightdata.com/mcp",
      homepage: "https://brightdata.com",
    },
    {
      id: "apify",
      name: "Apify",
      description: "Run web scrapers and automation actors",
      url: "https://mcp.apify.com",
      homepage: "https://apify.com",
    },
    {
      id: "fal",
      name: "Fal",
      description: "Generate images, video and audio",
      url: "https://mcp.fal.ai/mcp-relay",
      homepage: "https://fal.ai",
    },
    {
      id: "cloudinary",
      name: "Cloudinary",
      description: "Upload, transform and manage media assets",
      url: "https://asset-management.mcp.cloudinary.com/mcp",
      homepage: "https://cloudinary.com",
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs",
      description: "Voice agents, speech and audio",
      url: "https://api.elevenlabs.io/v1/mcp",
      homepage: "https://elevenlabs.io",
    },
    {
      id: "eachlabs",
      name: "Eachlabs",
      description: "Run image, video and audio models and workflows",
      url: "https://mcp.eachlabs.ai/mcp",
      homepage: "https://www.eachlabs.ai",
    },
  ]),
  ...shelf("design", "none", [
    {
      id: "excalidraw",
      name: "Excalidraw",
      description: "Hand-drawn diagrams and sketches",
      url: "https://mcp.excalidraw.com/mcp",
      homepage: "https://excalidraw.com",
    },
    {
      id: "drawio",
      name: "draw.io",
      description: "Flowcharts and architecture diagrams",
      url: "https://mcp.draw.io/mcp",
      homepage: "https://www.drawio.com",
    },
    {
      id: "tldraw",
      name: "tldraw",
      description: "Whiteboard canvases and diagrams",
      url: "https://tldraw-mcp-app.tldraw.workers.dev/mcp",
      homepage: "https://www.tldraw.com",
    },
  ]),
  ...shelf("design", "oauth", [
    {
      id: "canva",
      name: "Canva",
      description: "Designs, assets and exports",
      url: "https://mcp.canva.com/mcp",
      homepage: "https://www.canva.com",
    },
    {
      id: "miro",
      name: "Miro",
      description: "Boards, diagrams and sticky notes",
      url: "https://mcp.miro.com/",
      homepage: "https://miro.com",
    },
    {
      id: "lucid",
      name: "Lucid",
      description: "Lucidchart and Lucidspark documents",
      url: "https://mcp.lucid.app/mcp",
      homepage: "https://lucid.co",
    },
    {
      id: "mobbin",
      name: "Mobbin",
      description: "Real-world app screens and flows for reference",
      url: "https://api.mobbin.com/mcp",
      homepage: "https://mobbin.com",
    },
    {
      id: "webflow",
      name: "Webflow",
      description: "Sites, CMS collections and pages",
      url: "https://mcp.webflow.com/mcp",
      homepage: "https://webflow.com",
    },
    {
      id: "framer",
      name: "Framer",
      description: "Projects, pages and CMS content",
      url: "https://mcp.framer.com/mcp",
      homepage: "https://www.framer.com",
    },
    {
      id: "wix",
      name: "Wix",
      description: "Sites, stores, bookings and CMS",
      url: "https://mcp.wix.com/mcp",
      homepage: "https://www.wix.com",
    },
    {
      id: "sanity",
      name: "Sanity",
      description: "Content, schemas and datasets",
      url: "https://mcp.sanity.io",
      homepage: "https://www.sanity.io",
    },
    {
      id: "contentful",
      name: "Contentful",
      description: "Content types, entries and assets",
      url: "https://mcp.contentful.com/mcp",
      homepage: "https://www.contentful.com",
    },
    {
      id: "mintlify",
      name: "Mintlify",
      description: "Documentation sites and pages",
      url: "https://mcp.mintlify.com/mcp",
      homepage: "https://www.mintlify.com",
    },
    {
      id: "lovable",
      name: "Lovable",
      description: "Lovable projects and apps",
      url: "https://mcp.lovable.dev/mcp",
      homepage: "https://lovable.dev",
    },
    {
      id: "21st-dev",
      name: "21st.dev",
      description: "UI components and inspiration",
      url: "https://21st.dev/api/mcp",
      homepage: "https://21st.dev",
    },
  ]),
  ...shelf("work", "oauth", [
    {
      id: "linear",
      name: "Linear",
      description: "Issues, projects, cycles and comments",
      url: "https://mcp.linear.app/mcp",
      homepage: "https://linear.app",
    },
    {
      id: "notion",
      name: "Notion",
      description: "Pages, databases and workspace search",
      url: "https://mcp.notion.com/mcp",
      homepage: "https://www.notion.com",
    },
    {
      id: "atlassian",
      name: "Atlassian",
      description: "Jira issues and Confluence pages",
      url: "https://mcp.atlassian.com/v2/mcp",
      homepage: "https://www.atlassian.com",
    },
    {
      id: "clickup",
      name: "ClickUp",
      description: "Tasks, docs and comments",
      url: "https://mcp.clickup.com/mcp",
      homepage: "https://clickup.com",
    },
    {
      id: "trello",
      name: "Trello",
      description: "Boards, lists and cards",
      url: "https://mcp.trello.com/v1",
      homepage: "https://trello.com",
    },
    {
      id: "monday",
      name: "monday.com",
      description: "Boards, items and updates",
      url: "https://mcp.monday.com/mcp",
      homepage: "https://monday.com",
    },
    {
      id: "airtable",
      name: "Airtable",
      description: "Bases, tables and records",
      url: "https://mcp.airtable.com/mcp",
      homepage: "https://www.airtable.com",
    },
    {
      id: "todoist",
      name: "Todoist",
      description: "Tasks, projects and due dates",
      url: "https://ai.todoist.net/mcp",
      homepage: "https://www.todoist.com",
    },
    {
      id: "granola",
      name: "Granola",
      description: "Meeting notes and transcripts",
      url: "https://mcp.granola.ai/mcp",
      homepage: "https://www.granola.ai",
    },
    {
      id: "circleback",
      name: "Circleback",
      description: "Meeting notes and action items",
      url: "https://circleback.ai/api/mcp",
      homepage: "https://circleback.ai",
    },
  ]),
  ...shelf("business", "oauth", [
    {
      id: "stripe",
      name: "Stripe",
      description: "Customers, payments, subscriptions and invoices",
      url: "https://mcp.stripe.com/",
      homepage: "https://stripe.com",
    },
    {
      id: "paypal",
      name: "PayPal",
      description: "Invoices, orders, payments and disputes",
      url: "https://mcp.paypal.com/mcp",
      homepage: "https://www.paypal.com",
    },
    {
      id: "square",
      name: "Square",
      description: "Payments, orders, catalog and customers",
      url: "https://mcp.squareup.com/mcp",
      homepage: "https://squareup.com",
    },
    {
      id: "polar",
      name: "Polar",
      description: "Products, subscriptions, customers and payouts",
      url: "https://mcp.polar.sh/mcp/polar-mcp",
      homepage: "https://polar.sh",
    },
    {
      id: "paddle",
      name: "Paddle",
      description: "Products, prices, subscriptions and transactions",
      url: "https://mcp.paddle.com/mcp",
      homepage: "https://www.paddle.com",
    },
    {
      id: "autumn",
      name: "Autumn",
      description: "Plans, features, usage and billing",
      url: "https://mcp.useautumn.com/mcp",
      homepage: "https://useautumn.com",
    },
    {
      id: "dodopayments",
      name: "Dodo Payments",
      description: "Products, payments, subscriptions and customers",
      url: "https://mcp.dodopayments.com/mcp",
      homepage: "https://dodopayments.com",
    },
    {
      id: "ramp",
      name: "Ramp",
      description: "Spend, transactions and reimbursements",
      url: "https://ramp-mcp-remote.ramp.com/mcp",
      homepage: "https://ramp.com",
    },
    {
      id: "mercury",
      name: "Mercury",
      description: "Bank balances, transactions and recipients",
      url: "https://mcp.mercury.com/mcp",
      homepage: "https://mercury.com",
    },
    {
      id: "intercom",
      name: "Intercom",
      description: "Conversations and contacts in US workspaces",
      url: "https://mcp.intercom.com/mcp",
      homepage: "https://www.intercom.com",
    },
    {
      id: "intercom-eu",
      name: "Intercom EU",
      description: "Conversations and contacts in EU workspaces",
      url: "https://mcp.eu.intercom.com/mcp",
      homepage: "https://www.intercom.com",
    },
    {
      id: "brevo",
      name: "Brevo",
      description: "Contacts, campaigns and transactional email",
      url: "https://mcp.brevo.com/v1/brevo/mcp",
      homepage: "https://www.brevo.com",
    },
    {
      id: "resend",
      name: "Resend",
      description: "Send email and manage domains and audiences",
      url: "https://mcp.resend.com/mcp",
      homepage: "https://resend.com",
    },
    {
      id: "loops",
      name: "Loops",
      description: "Contacts, audiences and transactional email",
      url: "https://mcp.loops.so",
      homepage: "https://loops.so",
    },
    {
      id: "customerio",
      name: "Customer.io",
      description: "Campaigns, segments and people in US workspaces",
      url: "https://mcp.customer.io/mcp",
      homepage: "https://customer.io",
    },
    {
      id: "customerio-eu",
      name: "Customer.io EU",
      description: "Campaigns, segments and people in EU workspaces",
      url: "https://mcp-eu.customer.io/mcp",
      homepage: "https://customer.io",
    },
    {
      id: "ahrefs",
      name: "Ahrefs",
      description: "Keywords, backlinks and site audits",
      url: "https://api.ahrefs.com/mcp/mcp",
      homepage: "https://ahrefs.com",
    },
    {
      id: "semrush",
      name: "Semrush",
      description: "Keywords, domains, backlinks and traffic",
      url: "https://mcp.semrush.com/v2/mcp",
      homepage: "https://www.semrush.com",
    },
    {
      id: "openseo",
      name: "OpenSEO",
      description: "Keyword research, rankings and Search Console data",
      url: "https://app.openseo.so/mcp",
      homepage: "https://openseo.so",
    },
    {
      id: "calcom",
      name: "Cal.com",
      description: "Event types, availability and bookings",
      url: "https://mcp.cal.com/mcp",
      homepage: "https://cal.com",
    },
  ]),
];

export function findMcpConnectorPreset(id: string): McpConnectorPreset | undefined {
  return MCP_CONNECTOR_PRESETS.find((preset) => preset.id === id);
}

export type McpConnectorUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

// Custom servers must be public HTTPS endpoints. The server still pins every request to a public
// address; this check gives the person typing the URL an early, readable answer.
export function normalizeMcpConnectorUrl(input: string): McpConnectorUrlCheck {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Enter the server's URL." };
  if (trimmed.length > 2048) return { ok: false, reason: "The URL is too long." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "Enter a full URL, starting with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "The URL must start with https://." };
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the user name and password from the URL." };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}
