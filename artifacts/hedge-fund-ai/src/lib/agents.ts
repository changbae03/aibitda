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
  role: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  description: string;
};

export const AGENTS: Record<string, AgentInfo> = {
  company_intro: {
    id: "company_intro",
    name: "브리핑",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "분석 의뢰 접수 및 팀 소개"
  },
  industry_analysis: {
    id: "industry_analysis",
    name: "매크로 및 산업 분석",
    role: "Macro & Industry Analyst",
    icon: Globe2,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    description: "산업 구조, 성장률, 정책 환경, 경쟁 구도, 매크로 리스크"
  },
  company_analysis: {
    id: "company_analysis",
    name: "실적 전망",
    role: "Financial Analyst",
    icon: PieChart,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    description: "재무 분석(수익성·현금흐름·건전성) + Base 실적 추정"
  },
  relative_valuation: {
    id: "relative_valuation",
    name: "목표가 산출",
    role: "Valuation Analyst",
    icon: Scale,
    color: "text-violet-600",
    bgColor: "bg-violet-50",
    description: "DCF(절대가치) + 피어 멀티플(상대가치) → 조율 목표주가 1개"
  },
  market_analysis: {
    id: "market_analysis",
    name: "타점 분석",
    role: "Market & Technical Analyst",
    icon: BarChart2,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    description: "수급, 차트 분석, 진입/목표/손절 전략"
  },
  catalyst_analysis: {
    id: "catalyst_analysis",
    name: "투자 촉매 및 수급 분석",
    role: "Catalyst & Smart Money Analyst",
    icon: Zap,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    description: "주가 촉매 이벤트, 세력 움직임, 주도주 가능성"
  },
  investment_strategy: {
    id: "investment_strategy",
    name: "최종 결론",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "통합 검토 후 최종 투자 전략 도출"
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
