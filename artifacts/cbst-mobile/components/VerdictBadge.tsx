import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  verdict: string;
  size?: "sm" | "md";
}

function getVerdictStyle(verdict: string) {
  const v = verdict.toLowerCase();
  if (v.includes("strong buy")) return { bg: "#dcfce7", text: "#16a34a", label: "Strong Buy" };
  if (v.includes("buy")) return { bg: "#dbeafe", text: "#1d4ed8", label: "Buy" };
  if (v.includes("strong sell")) return { bg: "#fee2e2", text: "#dc2626", label: "Strong Sell" };
  if (v.includes("sell")) return { bg: "#fff7ed", text: "#ea580c", label: "Sell" };
  return { bg: "#f3f4f6", text: "#6b7280", label: "Hold" };
}

export function VerdictBadge({ verdict, size = "md" }: Props) {
  const style = getVerdictStyle(verdict);
  const isSmall = size === "sm";
  return (
    <View style={[styles.badge, { backgroundColor: style.bg, paddingHorizontal: isSmall ? 8 : 12, paddingVertical: isSmall ? 3 : 5 }]}>
      <Text style={[styles.text, { color: style.text, fontSize: isSmall ? 11 : 12 }]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 100,
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.1,
  },
});
