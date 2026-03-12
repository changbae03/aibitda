import { useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import { getListAnalysesQueryKey } from "./generated/api";

export function useDeleteAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      customFetch<{ success: boolean }>(`/api/analysis/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey() });
    },
  });
}
