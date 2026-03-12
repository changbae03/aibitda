import {
  ShieldCheck,
  Globe2,
  PieChart,
  BarChart2,
  Zap,
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
  industry_analysis: {
    id: "industry_analysis",
    name: "에이전트 1",
    role: "Macro & Industry Analyst",
    icon: Globe2,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    description: "산업 구조, 성장률, 정책 환경, 경쟁 구도, 매크로 리스크"
  },
  company_analysis: {
    id: "company_analysis",
    name: "에이전트 2",
    role: "Fundamental & Valuation Analyst",
    icon: PieChart,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50",
    description: "사업 구조, 재무 분석, 밸류에이션, 적정 주가"
  },
  market_analysis: {
    id: "market_analysis",
    name: "에이전트 3",
    role: "Market & Technical Analyst",
    icon: BarChart2,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    description: "수급, 차트 분석, 진입/목표/손절 전략"
  },
  catalyst_analysis: {
    id: "catalyst_analysis",
    name: "에이전트 4",
    role: "Catalyst & Smart Money Analyst",
    icon: Zap,
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    description: "주가 촉매 이벤트, 세력 움직임, 주도주 가능성"
  },
  investment_strategy: {
    id: "investment_strategy",
    name: "팀장",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "통합 검토 후 최종 투자 전략 도출"
  },
};

export const ANALYSIS_STEPS_ORDER = [
  "industry_analysis",
  "company_analysis",
  "market_analysis",
  "catalyst_analysis",
  "investment_strategy",
] as const;
