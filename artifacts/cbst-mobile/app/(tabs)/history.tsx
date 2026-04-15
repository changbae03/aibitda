import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useListAnalyses } from "@workspace/api-client-react";
import { AnalysisCard } from "@/components/AnalysisCard";

export default function HistoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: analyses, isLoading, refetch, isRefetching } = useListAnalyses();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  return (
    <FlatList
      data={analyses ?? []}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={[styles.container, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={refetch}
          tintColor={colors.foreground}
        />
      }
      ListHeaderComponent={
        <Text style={[styles.title, { color: colors.foreground }]}>분석 기록</Text>
      }
      renderItem={({ item }) => (
        <AnalysisCard analysis={item} onPress={() => router.push(`/analysis/${item.id}`)} />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Feather name="inbox" size={40} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>아직 분석이 없어요</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            홈에서 종목 코드를 입력해 분석을 시작해보세요
          </Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 20, letterSpacing: -0.3 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
