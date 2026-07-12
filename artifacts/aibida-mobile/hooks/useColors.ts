import colors from "@/constants/colors";

/**
 * Returns the design tokens for the app.
 * This app uses dark mode exclusively (finance/trading app).
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
