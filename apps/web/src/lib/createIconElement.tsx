import type { ReactElement } from "react";
import type { IconComponent } from "./iconComponent";

type StaticMarkupRenderer = (element: ReactElement) => string;

// Lexical builds chip DOM outside React, so icons go through static markup. The server renderer is
// large and chips are rare, so it loads on first use: until then the element is created empty and is
// filled in place, and afterwards rendering is synchronous.
let staticMarkupRenderer: StaticMarkupRenderer | null = null;
let staticMarkupRendererPromise: Promise<StaticMarkupRenderer> | null = null;

function withStaticMarkupRenderer(render: (renderer: StaticMarkupRenderer) => void): void {
  if (staticMarkupRenderer) {
    render(staticMarkupRenderer);
    return;
  }
  staticMarkupRendererPromise ??= import("react-dom/server").then(({ renderToStaticMarkup }) => {
    staticMarkupRenderer = renderToStaticMarkup;
    return renderToStaticMarkup;
  });
  void staticMarkupRendererPromise.then(render);
}

export function renderIconMarkupInto(host: HTMLElement, icon: ReactElement): void {
  withStaticMarkupRenderer((renderer) => {
    host.innerHTML = renderer(icon);
  });
}

export function createIconElement(Icon: IconComponent, className: string): SVGSVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("class", className);
  withStaticMarkupRenderer((renderer) => {
    const template = document.createElement("template");
    template.innerHTML = renderer(<Icon className={className} />);
    const rendered = template.content.firstElementChild;
    if (!(rendered instanceof SVGSVGElement)) throw new Error("Icon did not render an SVG");
    for (const attribute of Array.from(rendered.attributes)) {
      element.setAttribute(attribute.name, attribute.value);
    }
    element.replaceChildren(...Array.from(rendered.childNodes));
  });
  return element;
}
