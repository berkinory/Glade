import type { FC, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  filled?: boolean;
};
export type IconComponent = FC<IconProps>;
