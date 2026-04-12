import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  nickname: string;
  profileImage: string | null;
  iat?: number;
  exp?: number;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useAuth() {
  return useQuery<{ user: AuthUser | null }>({
    queryKey: ["auth/me"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
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
      await fetch(`${API_BASE}/api/auth/logout`, {
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
  const API_BASE_FULL = window.location.origin + (import.meta.env.BASE_URL.replace(/\/$/, ""));
  return `${API_BASE_FULL}/api/auth/kakao`;
}
