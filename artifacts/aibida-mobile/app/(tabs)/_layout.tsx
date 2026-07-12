import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>시장</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stocks">
        <Icon sf={{ default: "newspaper", selected: "newspaper.fill" }} />
        <Label>뉴스</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="analysis">
        <Icon sf={{ default: "brain.head.profile", selected: "brain.head.profile" }} />
        <Label>AI 분석</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="themes">
        <Icon sf={{ default: "flame", selected: "flame.fill" }} />
        <Label>테마</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="portfolio">
        <Icon sf={{ default: "person.circle", selected: "person.circle.fill" }} />
        <Label>MY</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFill} />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 10,
          fontFamily: "Inter_500Medium",
          marginBottom: isWeb ? 0 : 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "시장",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.bar.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="bar-chart-2" size={21} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="stocks"
        options={{
          title: "뉴스",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="newspaper.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="rss" size={21} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="analysis"
        options={{
          title: "AI 분석",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="cpu.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="cpu" size={21} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="themes"
        options={{
          title: "테마",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="flame.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="zap" size={21} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "MY",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.circle.fill" tintColor={color} size={22} />
            ) : (
              <Feather name="user" size={21} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
