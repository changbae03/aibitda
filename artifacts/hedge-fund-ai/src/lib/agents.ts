import {
  ShieldCheck,
  Globe2,
  PieChart,
  BarChart2,
  Zap,
  Scale,
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
  company_analysis: {
    id: "company_analysis",
    name: "실적 전망",
    nameEn: "Financial Analysis",
    role: "Financial Analyst",
    icon: PieChart,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "재무 분석(수익성·현금흐름·건전성) + Base 실적 추정",
    descriptionEn: "Financial analysis (profitability, cash flow, balance sheet) + base case estimates",
  },
  relative_valuation: {
    id: "relative_valuation",
    name: "적정주가 산출",
    nameEn: "Valuation",
    role: "Valuation Analyst",
    icon: Scale,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "DCF(절대가치) + 피어 멀티플(상대가치) → 조율 적정주가 1개",
    descriptionEn: "DCF (intrinsic value) + peer multiples (relative value) → single blended target price",
  },
  market_analysis: {
    id: "market_analysis",
    name: "기술적 분석",
    nameEn: "Technical Analysis",
    role: "Market & Technical Analyst",
    icon: BarChart2,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "차트 분석, 진입 구간, 손절 전략",
    descriptionEn: "Chart analysis, entry zone, stop-loss strategy",
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
  investment_strategy: {
    id: "investment_strategy",
    name: "최종 결론",
    nameEn: "Investment Conclusion",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    description: "통합 검토 후 최종 투자 전략 도출",
    descriptionEn: "Integrated review & final investment strategy",
  },
};

export const ANALYSIS_STEPS_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
] as const;
