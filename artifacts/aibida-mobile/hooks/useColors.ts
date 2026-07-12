import colors from "@/constants/colors";

/**
 * Returns the design tokens for the app.
 * Light theme to match the web PWA design.
 */
export function useColors() {
  return { ...colors.light, radius: colors.radius };
}
