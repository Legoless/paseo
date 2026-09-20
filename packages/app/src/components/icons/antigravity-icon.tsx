import Svg, { Path } from "react-native-svg";

interface AntigravityIconProps {
  size?: number;
  color?: string;
}

export function AntigravityIcon({ size = 16, color = "currentColor" }: AntigravityIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M8 1.5L13.75 14.5H11.45L10.2 11.45H5.75L4.55 14.5H2.25L8 1.5ZM6.5 9.55H9.45L8 5.95L6.5 9.55Z"
        fill={color}
      />
      <Path
        d="M2.25 7.9C2.25 5.1 4.55 2.85 7.4 2.85C10.75 2.85 13.35 5.65 13.35 8.9C13.35 11.4 11.35 13.15 9.1 13.15"
        stroke={color}
        strokeWidth={1.1}
        strokeLinecap="round"
      />
    </Svg>
  );
}
