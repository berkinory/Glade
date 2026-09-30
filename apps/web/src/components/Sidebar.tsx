import { useSidebarShellState } from "./useSidebarShellState";
import { useSidebarProjectNavigation } from "./useSidebarProjectNavigation";
import { useSidebarThreadCommands } from "./useSidebarThreadCommands";
import { useSidebarProjectCommands } from "./useSidebarProjectCommands";
import { useSidebarDerivedLists } from "./useSidebarDerivedLists";
import { useSidebarPanelEffects } from "./useSidebarPanelEffects";
import { SidebarView } from "./SidebarView";

export default function Sidebar() {
  const context1 = useSidebarShellState();
  const context2 = useSidebarProjectNavigation(context1);
  const context3 = useSidebarThreadCommands(context2);
  const context4 = useSidebarProjectCommands(context3);
  const context5 = useSidebarDerivedLists(context4);
  const context6 = useSidebarPanelEffects(context5);
  return <SidebarView context={context6} />;
}
