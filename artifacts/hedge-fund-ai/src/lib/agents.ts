import {
  Building2,
  Globe2,
  PieChart,
  Calculator,
  Activity,
  LineChart,
  Zap,
  Eye,
  ShieldCheck,
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
  industry_structure: {
    id: "industry_structure",
    name: "Agent 2",
    role: "Industry Structure Analyst",
    icon: Building2,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    description: "Analyzes market size, growth, value chain, and competitive landscape."
  },
  macro: {
    id: "macro",
    name: "Agent 1",
    role: "Global Macro Strategist",
    icon: Globe2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    description: "Evaluates interest rates, liquidity, policy, and geopolitical risks."
  },
  fundamental: {
    id: "fundamental",
    name: "Agent 3",
    role: "Fundamental Analyst",
    icon: PieChart,
    color: "text-indigo-400",
    bgColor: "bg-indigo-400/10",
    description: "Deep dive into revenue structures, ROE, FCF, and capital structures."
  },
  valuation: {
    id: "valuation",
    name: "Agent 4",
    role: "Valuation Specialist",
    icon: Calculator,
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    description: "Calculates intrinsic value using DCF, PBRxROE, or EV/EBITDA models."
  },
  market_microstructure: {
    id: "market_microstructure",
    name: "Agent 5",
    role: "Market Microstructure Analyst",
    icon: Activity,
    color: "text-rose-400",
    bgColor: "bg-rose-400/10",
    description: "Tracks institutional flows, foreign capital, short selling, and block trades."
  },
  technical: {
    id: "technical",
    name: "Agent 6",
    role: "Technical Strategist",
    icon: LineChart,
    color: "text-cyan-400",
    bgColor: "bg-cyan-400/10",
    description: "Identains entry/exit timings based on long/short term trend and volume analysis."
  },
  catalyst: {
    id: "catalyst",
    name: "Agent 7",
    role: "Catalyst Hunter",
    icon: Zap,
    color: "text-amber-400",
    bgColor: "bg-amber-400/10",
    description: "Detects upcoming events: policy changes, earnings turnarounds, product launches."
  },
  smart_money: {
    id: "smart_money",
    name: "Agent 8",
    role: "Smart Money Tracker",
    icon: Eye,
    color: "text-fuchsia-400",
    bgColor: "bg-fuchsia-400/10",
    description: "Monitors hidden institutional accumulation patterns and smart money movement."
  },
  lead_validation: {
    id: "lead_validation",
    name: "Team Lead",
    role: "Lead Portfolio Strategist",
    icon: ShieldCheck,
    color: "text-primary",
    bgColor: "bg-primary/10",
    description: "Synthesizes all insights, challenges hypotheses, and finalizes the investment strategy."
  }
};

export const ANALYSIS_STEPS_ORDER = [
  "industry_structure",
  "macro",
  "fundamental",
  "valuation",
  "market_microstructure",
  "technical",
  "catalyst",
  "smart_money",
  "lead_validation"
] as const;
