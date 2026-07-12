import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface SkeletonCardProps {
  height?: number;
  width?: number | string;
  borderRadius?: number;
  style?: ViewStyle;
}

export function SkeletonCard({
  height = 80,
  width = "100%",
  borderRadius,
  style,
}: SkeletonCardProps) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          height,
          width: width as any,
          borderRadius: borderRadius ?? colors.radius,
          backgroundColor: colors.accent,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonCard width={36} height={36} borderRadius={18} />
          <View style={styles.rowContent}>
            <SkeletonCard height={14} width="55%" />
            <SkeletonCard height={12} width="35%" style={{ marginTop: 6 }} />
          </View>
          <SkeletonCard width={50} height={14} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowContent: { flex: 1, gap: 6 },
});
