import { renderToStaticMarkup } from "react-dom/server";
import type { IconComponent } from "./iconComponent";

export function createIconElement(Icon: IconComponent, className: string): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = renderToStaticMarkup(<Icon className={className} />);
  const element = template.content.firstElementChild;
  if (!(element instanceof SVGSVGElement)) throw new Error("Icon did not render an SVG");
  return element;
}
