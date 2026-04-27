import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/utils";

export interface AuthUser {
  id: string;
  nickname: string;
  profileImage: string | null;
  iat?: number;
  exp?: number;
}

export function useAuth() {
  return useQuery<{ user: AuthUser | null }>({
    queryKey: ["auth/me"],
    queryFn: async () => {
      const res = await fetch(getApiUrl("/api/auth/me"), { credentials: "include" });
      if (!res.ok) return { user: null };
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch(getApiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    },
    onSuccess: () => {
      qc.setQueryData(["auth/me"], { user: null });
    },
  });
}

export function getKakaoLoginUrl() {
  const origin = window.location.origin + (import.meta.env.BASE_URL.replace(/\/$/, ""));
  return `${origin}/api/auth/kakao`;
}
