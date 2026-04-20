import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

const themes = [
  {
    value: "light",
    label: "라이트 모드",
    description: "항상 밝은 테마로 표시합니다",
    icon: Sun,
    preview: {
      bg: "bg-white",
      sidebar: "bg-neutral-100",
      card: "bg-white border-neutral-200",
      dot: "bg-neutral-800",
      line: "bg-neutral-200",
    },
  },
  {
    value: "dark",
    label: "다크 모드",
    description: "항상 어두운 테마로 표시합니다",
    icon: Moon,
    preview: {
      bg: "bg-[#0f172a]",
      sidebar: "bg-[#1e293b]",
      card: "bg-[#1e293b] border-[#334155]",
      dot: "bg-slate-200",
      line: "bg-[#334155]",
    },
  },
  {
    value: "system",
    label: "시스템 설정",
    description: "OS의 다크/라이트 설정을 따릅니다",
    icon: Monitor,
    preview: {
      bg: "bg-gradient-to-br from-white to-[#0f172a]",
      sidebar: "bg-gradient-to-b from-neutral-100 to-[#1e293b]",
      card: "bg-gradient-to-br from-white to-[#1e293b] border-neutral-300",
      dot: "bg-neutral-500",
      line: "bg-neutral-300",
    },
  },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  return (
    <div className="max-w-xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-foreground">설정</h1>
        <p className="text-sm text-muted-foreground mt-1">앱 외관 및 표시 설정을 변경합니다</p>
      </div>

      {/* 테마 섹션 */}
      <section>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          테마
        </h2>

        <div className="grid grid-cols-3 gap-3">
          {themes.map((t) => {
            const isSelected = mounted && theme === t.value;
            const Icon = t.icon;

            return (
              <motion.button
                key={t.value}
                onClick={() => setTheme(t.value)}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "relative flex flex-col items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40 hover:bg-accent/50"
                )}
              >
                {/* 미니 미리보기 */}
                <div className={cn("w-full h-16 rounded-xl overflow-hidden border", t.preview.card)}>
                  <div className="flex h-full">
                    {/* 사이드바 */}
                    <div className={cn("w-6 h-full", t.preview.sidebar)} />
                    {/* 콘텐츠 */}
                    <div className={cn("flex-1 p-2 flex flex-col gap-1.5", t.preview.bg)}>
                      <div className={cn("h-1.5 w-3/4 rounded-full", t.preview.line)} />
                      <div className={cn("h-1.5 w-1/2 rounded-full", t.preview.line)} />
                      <div className="flex-1" />
                      <div className={cn("h-1.5 w-full rounded-full opacity-50", t.preview.line)} />
                    </div>
                  </div>
                </div>

                {/* 아이콘 + 텍스트 */}
                <div className="flex flex-col items-center gap-1 w-full">
                  <Icon className={cn("w-4 h-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-[12px] font-semibold text-center", isSelected ? "text-foreground" : "text-muted-foreground")}>
                    {t.label}
                  </span>
                </div>

                {/* 선택 체크 */}
                {isSelected && (
                  <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>

        <p className="text-[11.5px] text-muted-foreground mt-3">
          {mounted && theme === "system"
            ? "현재 OS 설정을 따르고 있습니다. OS 설정 변경 시 자동으로 전환됩니다."
            : mounted && theme === "dark"
            ? "다크 모드가 활성화되어 있습니다."
            : "라이트 모드가 활성화되어 있습니다."}
        </p>
      </section>
    </div>
  );
}
