import { agents, DOCS_URL, faq, meta, RELEASES_URL, REPO_URL, SITE_URL } from "./site";

// One JSON-LD graph for search engines and answer engines: the app, the site and, on the page that
// shows it, the FAQ.
export function structuredData(options: { includeFaq: boolean }) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#app`,
        name: "Glade",
        description: meta.summary,
        url: SITE_URL,
        image: `${SITE_URL}/og.png`,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Windows, Linux",
        downloadUrl: RELEASES_URL,
        installUrl: RELEASES_URL,
        license: "https://opensource.org/license/mit",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        codeRepository: REPO_URL,
        sameAs: [REPO_URL],
        softwareHelp: { "@type": "CreativeWork", url: DOCS_URL },
        featureList: [
          ...agents.map((agent) => `Runs ${agent.name}`),
          "Skills and MCP servers shared across agents",
          "Computer Use and a built-in browser for agents",
          "SSH hosts and remote Glade machines",
          "Handoffs, worktrees, checkpoints and pull requests",
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Glade",
        description: meta.description,
        inLanguage: "en",
        about: { "@id": `${SITE_URL}/#app` },
      },
      ...(options.includeFaq ? [faqPage()] : []),
    ],
  };
}

function faqPage() {
  return {
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
