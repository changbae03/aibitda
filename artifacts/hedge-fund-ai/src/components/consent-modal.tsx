import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { ShieldCheck, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface Props {
  onConsented: () => void;
}

export default function ConsentModal({ onConsented }: Props) {
  const { isEn } = useLanguage();
  const t = (kr: string, en: string) => isEn ? en : kr;
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  async function handleConsent() {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/auth/consent"), {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["auth/me"] });
        onConsented();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary/10 px-6 py-5 flex items-center gap-3 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-foreground">
              {t("서비스 이용 동의", "Service Consent")}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {t("애빛다를 이용하기 전에 아래 내용을 확인해 주세요.", "Please review the following before using AiBITDA.")}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* 핵심 동의 사항 */}
          <div className="space-y-2.5">
            <ConsentItem
              title={t("포트폴리오 정보 관리자 열람", "Portfolio Visibility to Admins")}
              desc={t(
                "입력하신 포트폴리오(종목명, 평단가, 수량 등)는 서비스 운영을 위해 관리자가 열람할 수 있습니다.",
                "Your portfolio data (stock name, avg. price, qty, etc.) may be reviewed by admins for service operation."
              )}
            />
            <ConsentItem
              title={t("분석 이력 관리자 열람", "Analysis History Visibility")}
              desc={t(
                "요청하신 AI 분석 결과 및 이력이 서비스 품질 개선을 위해 관리자에게 공개됩니다.",
                "Your AI analysis requests and results are visible to admins for service quality improvement."
              )}
            />
            <ConsentItem
              title={t("개인정보 처리", "Personal Data Handling")}
              desc={t(
                "카카오 계정의 닉네임 및 이메일이 회원 관리 목적으로 저장됩니다.",
                "Your Kakao nickname and email are stored for account management purposes."
              )}
            />
          </div>

          {/* 상세 펼치기 */}
          <button
            onClick={() => setDetailOpen((v) => !v)}
            className="w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span>{t("상세 내용 보기", "View details")}</span>
            {detailOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {detailOpen && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2 text-[11px] text-muted-foreground leading-relaxed">
              <p>
                {t(
                  "• 수집 항목: 카카오 식별 ID, 닉네임, 이메일, 포트폴리오 데이터, 분석 요청 이력",
                  "• Collected: Kakao ID, nickname, email, portfolio data, analysis history"
                )}
              </p>
              <p>
                {t(
                  "• 수집 목적: 서비스 운영, 품질 개선, 부정 이용 방지",
                  "• Purpose: Service operation, quality improvement, fraud prevention"
                )}
              </p>
              <p>
                {t(
                  "• 제3자 제공: 법령에 따른 경우를 제외하고 외부에 제공하지 않습니다.",
                  "• Third-party sharing: Not shared externally except as required by law."
                )}
              </p>
              <p>
                {t(
                  "• 보유 기간: 회원 탈퇴 시까지, 법령상 보관 의무가 있는 경우 해당 기간",
                  "• Retention: Until account deletion, or as required by law."
                )}
              </p>
              <p>
                {t(
                  "• 동의 철회: 설정 > 계정 삭제를 통해 언제든지 탈퇴하실 수 있습니다.",
                  "• Withdrawal: You may withdraw consent at any time via Settings > Delete Account."
                )}
              </p>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t(
              "'동의하고 시작하기'를 누르면 위 내용에 동의하는 것으로 간주되며, 서비스를 이용하실 수 있습니다.",
              "By clicking 'Agree & Continue', you confirm your consent to the above and may proceed to use the service."
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <button
            onClick={handleConsent}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-[14px] bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("동의하고 시작하기", "Agree & Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsentItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
      <div>
        <div className="text-[12px] font-semibold text-foreground">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
