import { useEffect, useRef, useState, type ReactNode } from "react";

export function AmbientRailSlot(props: {
  readonly envOpen: boolean;
  readonly children: ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const [envHeight, setEnvHeight] = useState(0);
  useEffect(() => {
    const sibling = slotRef.current?.previousElementSibling as HTMLElement | null;
    if (!sibling) return;
    const update = () => {
      const height = sibling.offsetHeight;
      setEnvHeight((previous) => (previous === height ? previous : height));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sibling);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={slotRef}
      className="transition-[margin] duration-120 ease-out motion-reduce:transition-none"
      style={{ marginTop: props.envOpen ? 0 : -envHeight }}
    >
      {props.children}
    </div>
  );
}
