import type { APIRoute } from "astro";
import { pageMarkdown } from "../content/markdown";

export const GET: APIRoute = () =>
  new Response(pageMarkdown(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
