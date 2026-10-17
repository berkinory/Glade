import type { APIRoute } from "astro";
import { SITE_URL } from "../content/site";

export const GET: APIRoute = () => {
  const lastModified = new Date().toISOString().slice(0, 10);
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/"]
  .map(
    (path) =>
      `  <url>\n    <loc>${SITE_URL}${path}</loc>\n    <lastmod>${lastModified}</lastmod>\n  </url>`,
  )
  .join("\n")}
</urlset>
`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
