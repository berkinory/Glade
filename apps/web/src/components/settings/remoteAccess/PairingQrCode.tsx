import { encode } from "uqr";

// Drawn as one path of dark modules on a white field: scanners need dark-on-light contrast and a
// quiet zone, whatever the app theme.
export function PairingQrCode(props: { readonly value: string; readonly label: string }) {
  const { data, size } = encode(props.value, { ecc: "M", border: 2 });
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y]?.[x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return (
    <svg
      role="img"
      aria-label={props.label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-52 rounded-xl bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
