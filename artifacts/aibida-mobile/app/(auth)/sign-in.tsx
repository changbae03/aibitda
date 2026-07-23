import { useSignIn, useSSO } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
}

export default function SignInScreen() {
  useWarmUpBrowser();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);

  const isFetching = fetchStatus === "fetching";
  const needsTrust = signIn?.status === "needs_client_trust";

  const handleSubmit = async () => {
    setErrorMsg("");
    try {
      const { error } = await signIn.password({ emailAddress: email, password });
      if (error) { setErrorMsg(error.message ?? "로그인에 실패했습니다"); return; }
      if (signIn.status === "complete") {
        await signIn.finalize({ navigate: ({ decorateUrl }) => router.replace(decorateUrl("/") as any) });
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "오류가 발생했습니다");
    }
  };

  const handleVerify = async () => {
    setErrorMsg("");
    try {
      await signIn.mfa.verifyEmailCode({ code });
      if (signIn.status === "complete") {
        await signIn.finalize({ navigate: ({ decorateUrl }) => router.replace(decorateUrl("/") as any) });
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "인증에 실패했습니다");
    }
  };

  const handleGoogle = useCallback(async () => {
    setGoogleLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId) {
        setActive!({ session: createdSessionId, navigate: async ({ decorateUrl }) => router.replace(decorateUrl("/") as any) });
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Google 로그인에 실패했습니다");
    } finally {
      setGoogleLoading(false);
    }
  }, [startSSOFlow, router]);

  const handleKakao = useCallback(async () => {
    setKakaoLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_kakao",
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId) {
        setActive!({ session: createdSessionId, navigate: async ({ decorateUrl }) => router.replace(decorateUrl("/") as any) });
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "카카오 로그인에 실패했습니다");
    } finally {
      setKakaoLoading(false);
    }
  }, [startSSOFlow, router]);

  const primaryError =
    errors?.fields?.identifier?.message ??
    errors?.fields?.emailAddress?.message ??
    errors?.fields?.password?.message ??
    errorMsg ?? "";

  if (needsTrust) {
    return (
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[s.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}>
          <View style={s.topRow}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Feather name="x" size={20} color="#0d1421" />
            </TouchableOpacity>
          </View>
          <Text style={s.title}>본인 확인</Text>
          <Text style={s.subtitle}>이메일로 전송된 인증 코드를 입력하세요</Text>

          <TextInput
            style={s.input}
            value={code}
            placeholder="6자리 코드"
            placeholderTextColor="#9aa3b2"
            onChangeText={setCode}
            keyboardType="numeric"
            autoFocus
          />
          {!!primaryError && <Text style={s.errorText}>{primaryError}</Text>}

          <TouchableOpacity style={[s.primaryBtn, !code && s.disabled]} onPress={handleVerify} disabled={!code || isFetching}>
            {isFetching ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>인증 완료</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => signIn.mfa.sendEmailCode()}>
            <Text style={s.linkText}>코드 재전송</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[s.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={s.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="x" size={20} color="#0d1421" />
          </TouchableOpacity>
        </View>

        {/* Brand */}
        <View style={s.brand}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>애</Text>
          </View>
          <Text style={s.appName}>애빛다</Text>
          <Text style={s.appTagline}>AI 기반 헤지펀드 투자 분석</Text>
        </View>

        <Text style={s.title}>로그인</Text>

        {/* 카카오 */}
        <TouchableOpacity style={s.kakaoBtn} onPress={handleKakao} disabled={kakaoLoading}>
          {kakaoLoading
            ? <ActivityIndicator color="#3C1E1E" />
            : <>
                <Text style={s.kakaoIcon}>💬</Text>
                <Text style={s.kakaoBtnText}>카카오로 계속하기</Text>
              </>
          }
        </TouchableOpacity>

        {/* Google */}
        <TouchableOpacity style={s.googleBtn} onPress={handleGoogle} disabled={googleLoading}>
          {googleLoading
            ? <ActivityIndicator color="#0d1421" />
            : <>
                <Text style={s.googleIcon}>G</Text>
                <Text style={s.googleText}>Google로 계속하기</Text>
              </>
          }
        </TouchableOpacity>

        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>또는</Text>
          <View style={s.dividerLine} />
        </View>

        {/* Email */}
        <Text style={s.label}>이메일</Text>
        <TextInput
          style={s.input}
          value={email}
          placeholder="이메일 주소"
          placeholderTextColor="#9aa3b2"
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        <Text style={s.label}>비밀번호</Text>
        <View style={s.pwRow}>
          <TextInput
            style={[s.input, { flex: 1, marginBottom: 0 }]}
            value={password}
            placeholder="비밀번호"
            placeholderTextColor="#9aa3b2"
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoComplete="password"
          />
          <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPw((v) => !v)}>
            <Feather name={showPw ? "eye-off" : "eye"} size={18} color="#9aa3b2" />
          </TouchableOpacity>
        </View>

        {!!primaryError && <Text style={s.errorText}>{primaryError}</Text>}

        <TouchableOpacity
          style={[s.primaryBtn, (!email || !password || isFetching) && s.disabled]}
          onPress={handleSubmit}
          disabled={!email || !password || isFetching}
        >
          {isFetching ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>로그인</Text>}
        </TouchableOpacity>

        <View style={s.signupRow}>
          <Text style={s.signupText}>계정이 없으신가요? </Text>
          <TouchableOpacity onPress={() => router.replace("/(auth)/sign-up" as any)}>
            <Text style={s.signupLink}>회원가입</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f0f1f6" },
  container: { paddingHorizontal: 24, gap: 0 },
  topRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  brand: { alignItems: "center", gap: 8, marginBottom: 32, marginTop: 8 },
  logoBox: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center",
  },
  logoText: { fontSize: 30, fontFamily: "Pretendard-Bold", color: "#fff" },
  appName: { fontSize: 24, fontFamily: "Pretendard-Bold", color: "#0d1421" },
  appTagline: { fontSize: 15, color: "#5d6678", fontFamily: "Pretendard-Regular" },
  title: { fontSize: 24, fontFamily: "Pretendard-Bold", color: "#0d1421", marginBottom: 20 },
  subtitle: { fontSize: 16, color: "#5d6678", fontFamily: "Pretendard-Regular", marginBottom: 20 },
  kakaoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#FEE500", borderRadius: 12, paddingVertical: 14,
    marginBottom: 10,
  },
  kakaoIcon: { fontSize: 20 },
  kakaoBtnText: { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: "#3C1E1E" },
  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: "#dde0ea", marginBottom: 16,
  },
  googleIcon: { fontSize: 20, fontFamily: "Pretendard-Bold", color: "#4285f4" },
  googleText: { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: "#0d1421" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#dde0ea" },
  dividerText: { fontSize: 14, color: "#9aa3b2", fontFamily: "Pretendard-Regular" },
  label: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#5d6678", marginBottom: 6 },
  input: {
    backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 17, fontFamily: "Pretendard-Regular", color: "#0d1421",
    borderWidth: 1, borderColor: "#dde0ea", marginBottom: 14,
  },
  pwRow: { flexDirection: "row", alignItems: "center", gap: 0, marginBottom: 14 },
  eyeBtn: { position: "absolute", right: 14, alignSelf: "center" },
  errorText: { fontSize: 15, color: "#ef4444", fontFamily: "Pretendard-Regular", marginBottom: 10 },
  primaryBtn: {
    backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 15,
    alignItems: "center", justifyContent: "center", marginBottom: 16, marginTop: 4,
  },
  primaryBtnText: { fontSize: 18, fontFamily: "Pretendard-Bold", color: "#fff" },
  disabled: { opacity: 0.5 },
  linkBtn: { alignItems: "center", paddingVertical: 12 },
  linkText: { fontSize: 16, color: "#6366f1", fontFamily: "Pretendard-SemiBold" },
  signupRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 4 },
  signupText: { fontSize: 16, color: "#5d6678", fontFamily: "Pretendard-Regular" },
  signupLink: { fontSize: 16, color: "#6366f1", fontFamily: "Pretendard-SemiBold" },
});
