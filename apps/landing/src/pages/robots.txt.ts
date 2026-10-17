import type { APIRoute } from "astro";
import { SITE_URL } from "../content/site";

// Search engines and AI assistants are welcome to read, cite and learn from the public site.
// The OAuth client document stays reachable for the vendors that fetch it.
export const GET: APIRoute = () =>
  new Response(
    `User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
