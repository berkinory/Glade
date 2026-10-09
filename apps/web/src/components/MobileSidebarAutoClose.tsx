import { useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSidebar } from "./ui/sidebar";

// On a phone the sidebar sheet covers the chat; once the user picks a chat or starts one, it gets
// out of the way.
export function MobileSidebarAutoClose() {
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  return null;
}
