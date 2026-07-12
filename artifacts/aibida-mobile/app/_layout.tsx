import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider, ClerkLoaded } from "@clerk/expo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Platform } from "react-native";
import { setBaseUrl } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL ?? undefined;

const tokenCache =
  Platform.OS !== "web"
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ? (require("@clerk/expo/token-cache") as typeof import("@clerk/expo/token-cache")).tokenCache
    : undefined;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const HEADER_OPTS = {
  headerStyle: { backgroundColor: "#ffffff" },
  headerTintColor: "#0d1421",
  headerTitleStyle: { fontFamily: "Inter_600SemiBold", color: "#0d1421" } as any,
  headerBackTitle: "뒤로",
  contentStyle: { backgroundColor: "#f0f1f6" },
  headerShadowVisible: false,
};

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ ...HEADER_OPTS }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen
        name="analysis/[id]"
        options={{
          title: "AI 분석 보고서",
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
      <Stack.Screen
        name="mypage"
        options={{
          title: "내 계정",
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
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache} proxyUrl={proxyUrl}>
      <ClerkLoaded>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <StatusBar style="dark" />
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
