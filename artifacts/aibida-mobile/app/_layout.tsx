import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const HEADER_OPTS = {
  headerStyle: { backgroundColor: "#141821" },
  headerTintColor: "#e2e8f4",
  headerTitleStyle: { fontFamily: "Inter_600SemiBold", color: "#e2e8f4" } as any,
  headerBackTitle: "뒤로",
  contentStyle: { backgroundColor: "#0d1119" },
};

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ ...HEADER_OPTS }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="analysis/[id]"
        options={{
          title: "AI 분석",
          presentation: "modal",
          ...HEADER_OPTS,
        }}
      />
      <Stack.Screen
        name="new-analysis"
        options={{
          title: "새 AI 분석",
          presentation: "modal",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="tracker"
        options={{
          title: "트래커",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="popular"
        options={{
          title: "인기 분석",
          headerShown: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <StatusBar style="light" />
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
