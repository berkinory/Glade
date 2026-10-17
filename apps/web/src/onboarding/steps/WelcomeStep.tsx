import { ThemeModePicker } from "~/components/settings/ThemeModePicker";
import { useTheme } from "~/hooks/useTheme";

export function WelcomeStep() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-ui-sm font-medium text-muted-foreground">Appearance</h3>
      <ThemeModePicker value={theme} onValueChange={setTheme} ariaLabel="Appearance" />
    </section>
  );
}
