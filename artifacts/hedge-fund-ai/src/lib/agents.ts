import {
  ShieldCheck,
  Globe2,
  PieChart,
  Zap,
  LucideIcon
} from "lucide-react";

export type AgentInfo = {
  id: string;
  name: string;
  nameEn: string;
  role: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  description: string;
  descriptionEn: string;
};

export const AGENTS: Record<string, AgentInfo> = {
  company_intro: {
    id: "company_intro",
    name: "브리핑",
    nameEn: "Briefing",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "분석 의뢰 접수 및 팀 소개",
    descriptionEn: "Analysis brief & team introduction",
  },
  industry_analysis: {
    id: "industry_analysis",
    name: "매크로 및 산업 분석",
    nameEn: "Macro & Industry Analysis",
    role: "Macro & Industry Analyst",
    icon: Globe2,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "산업 구조, 성장률, 정책 환경, 경쟁 구도, 매크로 리스크",
    descriptionEn: "Industry structure, growth, policy environment, competitive dynamics, macro risks",
  },
  catalyst_analysis: {
    id: "catalyst_analysis",
    name: "투자 촉매 및 수급 분석",
    nameEn: "Catalyst & Flow Analysis",
    role: "Catalyst & Smart Money Analyst",
    icon: Zap,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    description: "주가 촉매 이벤트, 세력 움직임, 주도주 가능성",
    descriptionEn: "Catalyst events, institutional flows, market leadership signals",
  },
  company_analysis: {
    id: "company_analysis",
    name: "실적분석",
    nameEn: "Financial Analysis",
    role: "Financial Analyst",
    icon: PieChart,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "재무 수치 정리 + 컨센서스 전망치 소개",
    descriptionEn: "Financial figures & consensus estimates",
  },
  dart_report_analysis: {
    id: "dart_report_analysis",
    name: "사업보고서 분석",
    nameEn: "Business Report Analysis",
    role: "Business Intelligence Analyst",
    icon: PieChart,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    description: "사업 구성 변화·매출처 집중도·투자 방향·성장 단계·캐파 변화 분석",
    descriptionEn: "Business mix shifts, revenue concentration, investment direction, growth stage, capacity changes",
  },
  investment_strategy: {
    id: "investment_strategy",
    name: "결론",
    nameEn: "Conclusion",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "전 단계 종합 — 기회, 리스크, 모니터링 체크리스트",
    descriptionEn: "Full synthesis — opportunities, risks, monitoring checklist",
  },
};

export const ANALYSIS_STEPS_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "dart_report_analysis",
  "investment_strategy",
] as const;
