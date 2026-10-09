// Full-page messages shown instead of the app (a pairing link that failed, a removed device). The
// app's stylesheet never loads on these pages, so they carry the few design tokens they use and
// follow the system theme, like the boot splash.
const STYLE = `
.static-screen{min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:24px;
background:#fcfcfc;color:#262626;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.static-screen__body{max-width:340px;text-align:center}
.static-screen__logo{display:block;width:44px;height:44px;margin:0 auto 24px}
.static-screen h1{margin:0;font-size:22px;font-weight:600;line-height:1.25;letter-spacing:-0.01em;outline:none}
.static-screen p{margin:10px 0 0;font-size:15px;line-height:1.55;color:#6b6b6b}
@media (prefers-color-scheme: dark){.static-screen{background:#0e0e0e;color:#f5f5f5}.static-screen p{color:#9a9a9a}}
`;

export function renderStaticScreen(input: {
  readonly documentTitle: string;
  readonly title: string;
  readonly message: string;
  readonly alert?: boolean;
}): void {
  const root = document.getElementById("root");
  if (!root) return;
  document.title = `${input.documentTitle} · Glade`;
  const style = document.createElement("style");
  style.textContent = STYLE;
  const main = document.createElement("main");
  main.className = "static-screen";
  if (input.alert) main.setAttribute("role", "alert");
  const body = document.createElement("div");
  body.className = "static-screen__body";
  const logo = document.createElement("img");
  logo.className = "static-screen__logo";
  logo.src = "/glade-logo.svg";
  logo.alt = "";
  const title = document.createElement("h1");
  title.tabIndex = -1;
  title.textContent = input.title;
  const message = document.createElement("p");
  message.textContent = input.message;
  body.append(logo, title, message);
  main.append(body);
  root.replaceChildren(style, main);
  title.focus();
}
