import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/automations")({
  component: AutomationsLayout,
});

function AutomationsLayout() {
  return <Outlet />;
}
