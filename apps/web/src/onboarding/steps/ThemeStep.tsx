import { ThemeModePicker } from "~/components/settings/ThemeModePicker";
import { useTheme } from "~/hooks/useTheme";

export function ThemeStep() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="px-[100px]">
      <ThemeModePicker value={theme} onValueChange={setTheme} ariaLabel="Theme preference" />
    </div>
  );
}
