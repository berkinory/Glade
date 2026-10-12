import { useEffect, useState, type ReactNode } from "react";

import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_INNER_CLASS,
  DISCLOSURE_TRANSITION_MS,
  disclosureContentClassName,
  disclosureShellClassName,
} from "~/lib/disclosureMotion";

export function DisclosureRegion(props: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  // Renders the children only while open or closing, for content too heavy to keep mounted. They
  // mount closed and open on the next frame, and stay until the closing motion ends.
  lazy?: boolean;
}) {
  const { open, children, className, contentClassName, lazy = false } = props;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (!lazy) return;
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setShown(false);
    const timeout = window.setTimeout(
      () => setMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [lazy, open]);

  const visible = lazy ? open && shown : open;
  return (
    <div
      className={disclosureShellClassName(visible, className)}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
    >
      <div className={DISCLOSURE_INNER_CLASS}>
        <div className={disclosureContentClassName(visible, contentClassName)}>
          {!lazy || mounted ? children : null}
        </div>
      </div>
    </div>
  );
}
