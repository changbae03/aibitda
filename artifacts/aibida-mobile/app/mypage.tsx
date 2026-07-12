import { useAuth, useUser } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export default function MyPageScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut, isSignedIn } = useAuth();
  const { user, isLoaded } = useUser();

  const topPad = Platform.OS === "web" ? 24 : insets.top + 12;

  const handleSignOut = () => {
    Alert.alert("로그아웃", "정말 로그아웃 하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: async () => {
          await signOut();
          router.back();
        },
      },
    ]);
  };

  if (!isLoaded) {
    return (
      <View style={[s.flex, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const name = user?.fullName ?? user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress ?? "사용자";
  const email = user?.emailAddresses?.[0]?.emailAddress ?? "";
  const initials = name.slice(0, 2);

  return (
    <View style={[s.flex, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>내 계정</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Profile card */}
        <View style={[s.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[s.avatar, { backgroundColor: colors.primary }]}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.userName, { color: colors.foreground }]}>{name}</Text>
            {!!email && <Text style={[s.userEmail, { color: colors.mutedForeground }]}>{email}</Text>}
          </View>
        </View>

        {/* Menu items */}
        <View style={[s.section, { borderColor: colors.border }]}>
          <MenuItem icon="cpu" label="내 분석 이력" onPress={() => {}} colors={colors} />
          <MenuItem icon="activity" label="트래커" onPress={() => router.push("/tracker")} colors={colors} />
          <MenuItem icon="award" label="인기 분석" onPress={() => router.push("/popular")} colors={colors} />
        </View>

        <View style={[s.section, { borderColor: colors.border, marginTop: 12 }]}>
          <MenuItem icon="settings" label="설정" onPress={() => {}} colors={colors} />
          <MenuItem icon="help-circle" label="고객 지원" onPress={() => {}} colors={colors} />
          <MenuItem icon="file-text" label="이용약관" onPress={() => {}} colors={colors} />
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
          <TouchableOpacity style={[s.signOutBtn, { borderColor: colors.border }]} onPress={handleSignOut}>
            <Feather name="log-out" size={16} color="#ef4444" />
            <Text style={s.signOutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>

        <Text style={[s.version, { color: colors.mutedForeground }]}>애빛다 v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function MenuItem({
  icon, label, onPress, colors,
}: { icon: any; label: string; onPress: () => void; colors: any }) {
  return (
    <TouchableOpacity
      style={[s.menuItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Feather name={icon} size={18} color={colors.mutedForeground} />
      <Text style={[s.menuLabel, { color: colors.foreground }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    margin: 16, borderRadius: 16, padding: 16,
    borderWidth: 1,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  userName: { fontSize: 17, fontFamily: "Inter_700Bold" },
  userEmail: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: {
    marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  signOutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: 12, borderWidth: 1,
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#ef4444" },
  version: { textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 24 },
});
