import { CSSProperties } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "ion-icon": {
        name?: string;
        src?: string;
        mode?: "ios" | "md";
        color?: string;
        size?: "small" | "large" | string;
        style?: CSSProperties;
        class?: string;
        onClick?: (e: Event) => void;
      };
    }
  }
}

type IonIconProps = {
  name: string;
  size?: number | string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
};

export function IonIcon({ name, size = 16, color, className, style, onClick }: IonIconProps) {
  const sizeStr = typeof size === "number" ? `${size}px` : size;

  return (
    <ion-icon
      name={name}
      style={{
        fontSize: sizeStr,
        color: color || "currentColor",
        display: "inline-block",
        verticalAlign: "middle",
        ...style,
      }}
      class={className}
      onClick={onClick as unknown as (e: Event) => void}
    />
  );
}
