import type { APIRoute } from "astro";
import { pageMarkdown } from "../content/markdown";

export const GET: APIRoute = () =>
  new Response(pageMarkdown(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
