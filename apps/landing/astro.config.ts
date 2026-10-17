import { defineConfig } from "astro/config";

// Everything is prebuilt; the server only hands out files.
export default defineConfig({
  site: "https://useglade.dev",
  output: "static",
  trailingSlash: "never",
  build: {
    format: "file",
    // The page's CSS is small enough to ship inside the HTML, which saves a render-blocking request.
    inlineStylesheets: "always",
  },
});
