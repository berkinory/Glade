import type { ReactNode } from "react";

// One line of what a settings dialog will do, led by an icon; used in a `<ul>`.
export function DialogFact(props: { readonly icon: ReactNode; readonly children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">{props.icon}</span>
      <span className="text-ui-sm leading-snug text-muted-foreground">{props.children}</span>
    </li>
  );
}
