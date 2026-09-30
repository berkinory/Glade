import type { BrowserPanelProps } from "./browser/controller/browserPanelSupport";
import { useBrowserController } from "./browser/controller/useBrowserController";
import { BrowserControllerSurface } from "./browser/controller/BrowserControllerSurface";
export default function BrowserPanel(props: BrowserPanelProps) {
  const controller = useBrowserController(props);
  return <BrowserControllerSurface controller={controller} />;
}
