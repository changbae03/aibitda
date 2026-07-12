import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#f0f1f6" },
        animation: "slide_from_bottom",
      }}
    />
  );
}
