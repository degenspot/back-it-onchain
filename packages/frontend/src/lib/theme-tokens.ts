export const themeTokens = {
  colors: {
    background: "#0a0a0f",
    foreground: "#f8fafc",
    primary: "#8b5cf6",
    primaryForeground: "#ffffff",
    secondary: "#1e1e2e",
    secondaryForeground: "#f8fafc",
    muted: "#1e1e2e",
    mutedForeground: "#94a3b8",
    accent: "#ec4899",
    accentForeground: "#ffffff",
    destructive: "#ef4444",
    destructiveForeground: "#f8fafc",
    border: "#2d2d3d",
    input: "#2d2d3d",
    ring: "#8b5cf6",
    card: "#12121a",
    cardForeground: "#f8fafc",
  },
  breakpoints: {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px",
  },
  radius: {
    sm: "calc(0.75rem - 4px)",
    md: "calc(0.75rem - 2px)",
    lg: "0.75rem",
  },
} as const;

export type ThemeTokens = typeof themeTokens;