/**
 * us-full-harvester.ts
 * S&P 500 + NASDAQ 주요 종목 ~600개의 재무 데이터를 us_stocks 테이블에 구축.
 *
 * 동작 방식:
 * 1. syncUsList()    — 하드코딩 마스터 리스트 → us_stocks INSERT (중복 스킵)
 * 2. fetchPending()  — data_fetched=false 종목 Yahoo Finance 호출 → 업데이트
 *    · CONCURRENCY=10, 배치간 200ms 딜레이, 1회 300건 처리
 *    · 서버 시작 시 + 12시간 주기 자동 실행
 */

import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { classifySector } from "../routes/performance.js";

const yahoo = new YahooFinance();

const CONCURRENCY  = 10;
const DELAY_MS     = 200;
const BATCH_LIMIT  = 300;
const REFRESH_DAYS = 7;

// ─── 미국 주요 종목 마스터 리스트 (~600개) ────────────────────────────────────
export interface UsStockEntry {
  ticker: string;
  name: string;
  exchange: string;
}

export const US_MASTER_LIST: UsStockEntry[] = [
  // ── Mega Cap Tech ──────────────────────────────────────────────────────────
  { ticker: "AAPL",  name: "Apple",                    exchange: "NASDAQ" },
  { ticker: "MSFT",  name: "Microsoft",                exchange: "NASDAQ" },
  { ticker: "NVDA",  name: "NVIDIA",                   exchange: "NASDAQ" },
  { ticker: "GOOGL", name: "Alphabet Class A",          exchange: "NASDAQ" },
  { ticker: "GOOG",  name: "Alphabet Class C",          exchange: "NASDAQ" },
  { ticker: "META",  name: "Meta Platforms",            exchange: "NASDAQ" },
  { ticker: "AMZN",  name: "Amazon",                   exchange: "NASDAQ" },
  { ticker: "TSLA",  name: "Tesla",                    exchange: "NASDAQ" },
  { ticker: "AVGO",  name: "Broadcom",                 exchange: "NASDAQ" },
  { ticker: "ORCL",  name: "Oracle",                   exchange: "NYSE"   },
  // ── Semiconductors ────────────────────────────────────────────────────────
  { ticker: "AMD",   name: "Advanced Micro Devices",   exchange: "NASDAQ" },
  { ticker: "QCOM",  name: "Qualcomm",                 exchange: "NASDAQ" },
  { ticker: "INTC",  name: "Intel",                    exchange: "NASDAQ" },
  { ticker: "TXN",   name: "Texas Instruments",        exchange: "NASDAQ" },
  { ticker: "MU",    name: "Micron Technology",        exchange: "NASDAQ" },
  { ticker: "AMAT",  name: "Applied Materials",        exchange: "NASDAQ" },
  { ticker: "LRCX",  name: "Lam Research",             exchange: "NASDAQ" },
  { ticker: "KLAC",  name: "KLA Corporation",          exchange: "NASDAQ" },
  { ticker: "MRVL",  name: "Marvell Technology",       exchange: "NASDAQ" },
  { ticker: "ON",    name: "ON Semiconductor",         exchange: "NASDAQ" },
  { ticker: "NXPI",  name: "NXP Semiconductors",       exchange: "NASDAQ" },
  { ticker: "ADI",   name: "Analog Devices",           exchange: "NASDAQ" },
  { ticker: "MCHP",  name: "Microchip Technology",     exchange: "NASDAQ" },
  { ticker: "STX",   name: "Seagate Technology",       exchange: "NASDAQ" },
  { ticker: "WDC",   name: "Western Digital",          exchange: "NASDAQ" },
  { ticker: "TSM",   name: "TSMC",                     exchange: "NYSE"   },
  { ticker: "ASML",  name: "ASML Holding",             exchange: "NASDAQ" },
  { ticker: "ARM",   name: "Arm Holdings",             exchange: "NASDAQ" },
  // ── Software / Cloud ──────────────────────────────────────────────────────
  { ticker: "CRM",   name: "Salesforce",               exchange: "NYSE"   },
  { ticker: "ADBE",  name: "Adobe",                    exchange: "NASDAQ" },
  { ticker: "INTU",  name: "Intuit",                   exchange: "NASDAQ" },
  { ticker: "NOW",   name: "ServiceNow",               exchange: "NYSE"   },
  { ticker: "WDAY",  name: "Workday",                  exchange: "NASDAQ" },
  { ticker: "TEAM",  name: "Atlassian",                exchange: "NASDAQ" },
  { ticker: "HUBS",  name: "HubSpot",                  exchange: "NYSE"   },
  { ticker: "SNPS",  name: "Synopsys",                 exchange: "NASDAQ" },
  { ticker: "CDNS",  name: "Cadence Design Systems",   exchange: "NASDAQ" },
  { ticker: "ANSS",  name: "ANSYS",                    exchange: "NASDAQ" },
  { ticker: "PTC",   name: "PTC Inc",                  exchange: "NASDAQ" },
  { ticker: "CTSH",  name: "Cognizant Technology",     exchange: "NASDAQ" },
  { ticker: "ACN",   name: "Accenture",                exchange: "NYSE"   },
  { ticker: "IBM",   name: "IBM",                      exchange: "NYSE"   },
  { ticker: "CSCO",  name: "Cisco Systems",            exchange: "NASDAQ" },
  { ticker: "ANET",  name: "Arista Networks",          exchange: "NYSE"   },
  // ── Cybersecurity ─────────────────────────────────────────────────────────
  { ticker: "FTNT",  name: "Fortinet",                 exchange: "NASDAQ" },
  { ticker: "PANW",  name: "Palo Alto Networks",       exchange: "NASDAQ" },
  { ticker: "CRWD",  name: "CrowdStrike",              exchange: "NASDAQ" },
  { ticker: "ZS",    name: "Zscaler",                  exchange: "NASDAQ" },
  { ticker: "OKTA",  name: "Okta",                     exchange: "NASDAQ" },
  { ticker: "NET",   name: "Cloudflare",               exchange: "NYSE"   },
  { ticker: "S",     name: "SentinelOne",              exchange: "NYSE"   },
  // ── AI / Data ─────────────────────────────────────────────────────────────
  { ticker: "PLTR",  name: "Palantir",                 exchange: "NYSE"   },
  { ticker: "DDOG",  name: "Datadog",                  exchange: "NASDAQ" },
  { ticker: "MDB",   name: "MongoDB",                  exchange: "NASDAQ" },
  { ticker: "SNOW",  name: "Snowflake",                exchange: "NYSE"   },
  { ticker: "AI",    name: "C3.ai",                    exchange: "NYSE"   },
  { ticker: "BBAI",  name: "BigBear.ai",               exchange: "NYSE"   },
  { ticker: "SOUN",  name: "SoundHound AI",            exchange: "NASDAQ" },
  // ── Internet / E-Commerce ─────────────────────────────────────────────────
  { ticker: "SHOP",  name: "Shopify",                  exchange: "NYSE"   },
  { ticker: "UBER",  name: "Uber",                     exchange: "NYSE"   },
  { ticker: "LYFT",  name: "Lyft",                     exchange: "NASDAQ" },
  { ticker: "DASH",  name: "DoorDash",                 exchange: "NYSE"   },
  { ticker: "ABNB",  name: "Airbnb",                   exchange: "NASDAQ" },
  { ticker: "BKNG",  name: "Booking Holdings",         exchange: "NASDAQ" },
  { ticker: "EXPE",  name: "Expedia",                  exchange: "NASDAQ" },
  { ticker: "TRIP",  name: "TripAdvisor",              exchange: "NASDAQ" },
  { ticker: "ETSY",  name: "Etsy",                     exchange: "NASDAQ" },
  { ticker: "EBAY",  name: "eBay",                     exchange: "NASDAQ" },
  { ticker: "W",     name: "Wayfair",                  exchange: "NYSE"   },
  // ── Media / Entertainment ─────────────────────────────────────────────────
  { ticker: "NFLX",  name: "Netflix",                  exchange: "NASDAQ" },
  { ticker: "DIS",   name: "Walt Disney",              exchange: "NYSE"   },
  { ticker: "CMCSA", name: "Comcast",                  exchange: "NASDAQ" },
  { ticker: "WBD",   name: "Warner Bros. Discovery",   exchange: "NASDAQ" },
  { ticker: "PARA",  name: "Paramount Global",         exchange: "NASDAQ" },
  { ticker: "SPOT",  name: "Spotify",                  exchange: "NYSE"   },
  { ticker: "RBLX",  name: "Roblox",                   exchange: "NYSE"   },
  { ticker: "MTCH",  name: "Match Group",              exchange: "NASDAQ" },
  { ticker: "SNAP",  name: "Snap",                     exchange: "NYSE"   },
  { ticker: "PINS",  name: "Pinterest",                exchange: "NYSE"   },
  { ticker: "RDDT",  name: "Reddit",                   exchange: "NYSE"   },
  // ── Telecom ───────────────────────────────────────────────────────────────
  { ticker: "T",     name: "AT&T",                     exchange: "NYSE"   },
  { ticker: "VZ",    name: "Verizon",                  exchange: "NYSE"   },
  { ticker: "TMUS",  name: "T-Mobile US",              exchange: "NASDAQ" },
  // ── Fintech / Payments ────────────────────────────────────────────────────
  { ticker: "V",     name: "Visa",                     exchange: "NYSE"   },
  { ticker: "MA",    name: "Mastercard",               exchange: "NYSE"   },
  { ticker: "PYPL",  name: "PayPal",                   exchange: "NASDAQ" },
  { ticker: "SQ",    name: "Block",                    exchange: "NYSE"   },
  { ticker: "AFRM",  name: "Affirm",                   exchange: "NASDAQ" },
  { ticker: "UPST",  name: "Upstart",                  exchange: "NASDAQ" },
  { ticker: "SOFI",  name: "SoFi Technologies",        exchange: "NASDAQ" },
  { ticker: "COIN",  name: "Coinbase",                 exchange: "NASDAQ" },
  { ticker: "MSTR",  name: "MicroStrategy",            exchange: "NASDAQ" },
  { ticker: "HOOD",  name: "Robinhood Markets",        exchange: "NASDAQ" },
  { ticker: "FICO",  name: "Fair Isaac (FICO)",        exchange: "NYSE"   },
  // ── Banking ───────────────────────────────────────────────────────────────
  { ticker: "JPM",   name: "JPMorgan Chase",           exchange: "NYSE"   },
  { ticker: "BAC",   name: "Bank of America",          exchange: "NYSE"   },
  { ticker: "WFC",   name: "Wells Fargo",              exchange: "NYSE"   },
  { ticker: "C",     name: "Citigroup",                exchange: "NYSE"   },
  { ticker: "USB",   name: "US Bancorp",               exchange: "NYSE"   },
  { ticker: "PNC",   name: "PNC Financial",            exchange: "NYSE"   },
  { ticker: "TFC",   name: "Truist Financial",         exchange: "NYSE"   },
  { ticker: "COF",   name: "Capital One",              exchange: "NYSE"   },
  { ticker: "RF",    name: "Regions Financial",        exchange: "NYSE"   },
  { ticker: "KEY",   name: "KeyCorp",                  exchange: "NYSE"   },
  { ticker: "HBAN",  name: "Huntington Bancshares",    exchange: "NASDAQ" },
  { ticker: "MTB",   name: "M&T Bank",                 exchange: "NYSE"   },
  { ticker: "CFG",   name: "Citizens Financial",       exchange: "NYSE"   },
  { ticker: "FITB",  name: "Fifth Third Bancorp",      exchange: "NASDAQ" },
  { ticker: "ALLY",  name: "Ally Financial",           exchange: "NYSE"   },
  // ── Investment Banking / Asset Mgmt ───────────────────────────────────────
  { ticker: "MS",    name: "Morgan Stanley",           exchange: "NYSE"   },
  { ticker: "GS",    name: "Goldman Sachs",            exchange: "NYSE"   },
  { ticker: "BLK",   name: "BlackRock",                exchange: "NYSE"   },
  { ticker: "SCHW",  name: "Charles Schwab",           exchange: "NYSE"   },
  { ticker: "AXP",   name: "American Express",         exchange: "NYSE"   },
  { ticker: "IBKR",  name: "Interactive Brokers",      exchange: "NASDAQ" },
  { ticker: "RJF",   name: "Raymond James",            exchange: "NYSE"   },
  { ticker: "LPLA",  name: "LPL Financial",            exchange: "NASDAQ" },
  { ticker: "BRK-B", name: "Berkshire Hathaway B",     exchange: "NYSE"   },
  // ── Insurance ─────────────────────────────────────────────────────────────
  { ticker: "CB",    name: "Chubb",                    exchange: "NYSE"   },
  { ticker: "PRU",   name: "Prudential Financial",     exchange: "NYSE"   },
  { ticker: "MET",   name: "MetLife",                  exchange: "NYSE"   },
  { ticker: "AFL",   name: "Aflac",                    exchange: "NYSE"   },
  { ticker: "ALL",   name: "Allstate",                 exchange: "NYSE"   },
  { ticker: "TRV",   name: "Travelers Companies",      exchange: "NYSE"   },
  { ticker: "PGR",   name: "Progressive",              exchange: "NYSE"   },
  { ticker: "HIG",   name: "Hartford Financial",       exchange: "NYSE"   },
  { ticker: "AIG",   name: "American International",   exchange: "NYSE"   },
  // ── Exchanges / Data ──────────────────────────────────────────────────────
  { ticker: "SPGI",  name: "S&P Global",               exchange: "NYSE"   },
  { ticker: "MCO",   name: "Moody's",                  exchange: "NYSE"   },
  { ticker: "ICE",   name: "Intercontinental Exchange",exchange: "NYSE"   },
  { ticker: "CME",   name: "CME Group",                exchange: "NASDAQ" },
  { ticker: "NDAQ",  name: "Nasdaq Inc",               exchange: "NASDAQ" },
  { ticker: "CBOE",  name: "Cboe Global Markets",      exchange: "CBOE"   },
  { ticker: "FIS",   name: "Fidelity National Info",   exchange: "NYSE"   },
  { ticker: "FI",    name: "Fiserv",                   exchange: "NASDAQ" },
  { ticker: "GPN",   name: "Global Payments",          exchange: "NYSE"   },
  // ── Healthcare / Pharma ───────────────────────────────────────────────────
  { ticker: "JNJ",   name: "Johnson & Johnson",        exchange: "NYSE"   },
  { ticker: "LLY",   name: "Eli Lilly",                exchange: "NYSE"   },
  { ticker: "ABBV",  name: "AbbVie",                   exchange: "NYSE"   },
  { ticker: "MRK",   name: "Merck",                    exchange: "NYSE"   },
  { ticker: "PFE",   name: "Pfizer",                   exchange: "NYSE"   },
  { ticker: "AMGN",  name: "Amgen",                    exchange: "NASDAQ" },
  { ticker: "GILD",  name: "Gilead Sciences",          exchange: "NASDAQ" },
  { ticker: "BMY",   name: "Bristol-Myers Squibb",     exchange: "NYSE"   },
  { ticker: "BIIB",  name: "Biogen",                   exchange: "NASDAQ" },
  { ticker: "REGN",  name: "Regeneron",                exchange: "NASDAQ" },
  { ticker: "VRTX",  name: "Vertex Pharmaceuticals",   exchange: "NASDAQ" },
  { ticker: "MRNA",  name: "Moderna",                  exchange: "NASDAQ" },
  { ticker: "BNTX",  name: "BioNTech",                 exchange: "NASDAQ" },
  { ticker: "NVO",   name: "Novo Nordisk",             exchange: "NYSE"   },
  { ticker: "AZN",   name: "AstraZeneca",              exchange: "NASDAQ" },
  { ticker: "NVS",   name: "Novartis",                 exchange: "NYSE"   },
  { ticker: "SNY",   name: "Sanofi",                   exchange: "NASDAQ" },
  { ticker: "INVA",  name: "Innoviva",                 exchange: "NASDAQ" },
  { ticker: "EXAS",  name: "Exact Sciences",           exchange: "NASDAQ" },
  { ticker: "NTRA",  name: "Natera",                   exchange: "NASDAQ" },
  { ticker: "HIMS",  name: "Hims & Hers Health",       exchange: "NYSE"   },
  // ── MedTech / Devices ─────────────────────────────────────────────────────
  { ticker: "ISRG",  name: "Intuitive Surgical",       exchange: "NASDAQ" },
  { ticker: "BSX",   name: "Boston Scientific",        exchange: "NYSE"   },
  { ticker: "MDT",   name: "Medtronic",                exchange: "NYSE"   },
  { ticker: "ABT",   name: "Abbott Laboratories",      exchange: "NYSE"   },
  { ticker: "DHR",   name: "Danaher",                  exchange: "NYSE"   },
  { ticker: "TMO",   name: "Thermo Fisher Scientific", exchange: "NYSE"   },
  { ticker: "ILMN",  name: "Illumina",                 exchange: "NASDAQ" },
  { ticker: "A",     name: "Agilent Technologies",     exchange: "NYSE"   },
  { ticker: "IDXX",  name: "IDEXX Laboratories",       exchange: "NASDAQ" },
  { ticker: "IQV",   name: "IQVIA Holdings",           exchange: "NYSE"   },
  { ticker: "ZBH",   name: "Zimmer Biomet",            exchange: "NYSE"   },
  { ticker: "SYK",   name: "Stryker",                  exchange: "NYSE"   },
  { ticker: "EW",    name: "Edwards Lifesciences",     exchange: "NYSE"   },
  { ticker: "HOLX",  name: "Hologic",                  exchange: "NASDAQ" },
  { ticker: "DXCM",  name: "Dexcom",                   exchange: "NASDAQ" },
  { ticker: "RMD",   name: "ResMed",                   exchange: "NYSE"   },
  { ticker: "BDX",   name: "Becton Dickinson",         exchange: "NYSE"   },
  // ── Healthcare Services / Insurance ───────────────────────────────────────
  { ticker: "UNH",   name: "UnitedHealth Group",       exchange: "NYSE"   },
  { ticker: "HUM",   name: "Humana",                   exchange: "NYSE"   },
  { ticker: "CVS",   name: "CVS Health",               exchange: "NYSE"   },
  { ticker: "CI",    name: "Cigna",                    exchange: "NYSE"   },
  { ticker: "CNC",   name: "Centene",                  exchange: "NYSE"   },
  { ticker: "MOH",   name: "Molina Healthcare",        exchange: "NYSE"   },
  { ticker: "HCA",   name: "HCA Healthcare",           exchange: "NYSE"   },
  { ticker: "THC",   name: "Tenet Healthcare",         exchange: "NYSE"   },
  { ticker: "TDOC",  name: "Teladoc Health",           exchange: "NYSE"   },
  // ── Consumer Discretionary ────────────────────────────────────────────────
  { ticker: "HD",    name: "Home Depot",               exchange: "NYSE"   },
  { ticker: "LOW",   name: "Lowe's",                   exchange: "NYSE"   },
  { ticker: "NKE",   name: "Nike",                     exchange: "NYSE"   },
  { ticker: "MCD",   name: "McDonald's",               exchange: "NYSE"   },
  { ticker: "SBUX",  name: "Starbucks",                exchange: "NASDAQ" },
  { ticker: "YUM",   name: "Yum! Brands",              exchange: "NYSE"   },
  { ticker: "CMG",   name: "Chipotle Mexican Grill",   exchange: "NYSE"   },
  { ticker: "DPZ",   name: "Domino's Pizza",           exchange: "NYSE"   },
  { ticker: "DRI",   name: "Darden Restaurants",       exchange: "NYSE"   },
  { ticker: "QSR",   name: "Restaurant Brands Intl",   exchange: "NYSE"   },
  { ticker: "BURL",  name: "Burlington Stores",        exchange: "NYSE"   },
  { ticker: "ROST",  name: "Ross Stores",              exchange: "NASDAQ" },
  { ticker: "TJX",   name: "TJX Companies",            exchange: "NYSE"   },
  { ticker: "TSCO",  name: "Tractor Supply",           exchange: "NASDAQ" },
  { ticker: "BBY",   name: "Best Buy",                 exchange: "NYSE"   },
  { ticker: "RH",    name: "RH (Restoration Hardware)",exchange: "NYSE"   },
  { ticker: "WSM",   name: "Williams-Sonoma",          exchange: "NYSE"   },
  { ticker: "FIVE",  name: "Five Below",               exchange: "NASDAQ" },
  { ticker: "F",     name: "Ford Motor",               exchange: "NYSE"   },
  { ticker: "GM",    name: "General Motors",           exchange: "NYSE"   },
  { ticker: "RIVN",  name: "Rivian Automotive",        exchange: "NASDAQ" },
  { ticker: "LCID",  name: "Lucid Group",              exchange: "NASDAQ" },
  { ticker: "HOG",   name: "Harley-Davidson",          exchange: "NYSE"   },
  { ticker: "LVS",   name: "Las Vegas Sands",          exchange: "NYSE"   },
  { ticker: "WYNN",  name: "Wynn Resorts",             exchange: "NASDAQ" },
  { ticker: "MGM",   name: "MGM Resorts",              exchange: "NYSE"   },
  { ticker: "CZR",   name: "Caesars Entertainment",    exchange: "NASDAQ" },
  { ticker: "DKNG",  name: "DraftKings",               exchange: "NASDAQ" },
  // ── Consumer Staples ──────────────────────────────────────────────────────
  { ticker: "PG",    name: "Procter & Gamble",         exchange: "NYSE"   },
  { ticker: "KO",    name: "Coca-Cola",                exchange: "NYSE"   },
  { ticker: "PEP",   name: "PepsiCo",                  exchange: "NASDAQ" },
  { ticker: "MNST",  name: "Monster Beverage",         exchange: "NASDAQ" },
  { ticker: "STZ",   name: "Constellation Brands",     exchange: "NYSE"   },
  { ticker: "BF-B",  name: "Brown-Forman B",           exchange: "NYSE"   },
  { ticker: "MDLZ",  name: "Mondelez International",   exchange: "NASDAQ" },
  { ticker: "HSY",   name: "Hershey",                  exchange: "NYSE"   },
  { ticker: "K",     name: "Kellanova",                exchange: "NYSE"   },
  { ticker: "GIS",   name: "General Mills",            exchange: "NYSE"   },
  { ticker: "CPB",   name: "Campbell Soup",            exchange: "NYSE"   },
  { ticker: "TSN",   name: "Tyson Foods",              exchange: "NYSE"   },
  { ticker: "HRL",   name: "Hormel Foods",             exchange: "NYSE"   },
  { ticker: "CL",    name: "Colgate-Palmolive",        exchange: "NYSE"   },
  { ticker: "KMB",   name: "Kimberly-Clark",           exchange: "NYSE"   },
  { ticker: "CHD",   name: "Church & Dwight",          exchange: "NYSE"   },
  { ticker: "EL",    name: "Estee Lauder",             exchange: "NYSE"   },
  { ticker: "ULTA",  name: "Ulta Beauty",              exchange: "NASDAQ" },
  { ticker: "MO",    name: "Altria Group",             exchange: "NYSE"   },
  { ticker: "PM",    name: "Philip Morris International", exchange: "NYSE" },
  { ticker: "BTI",   name: "British American Tobacco",  exchange: "NYSE"  },
  // ── Retail ────────────────────────────────────────────────────────────────
  { ticker: "WMT",   name: "Walmart",                  exchange: "NYSE"   },
  { ticker: "COST",  name: "Costco",                   exchange: "NASDAQ" },
  { ticker: "TGT",   name: "Target",                   exchange: "NYSE"   },
  { ticker: "KR",    name: "Kroger",                   exchange: "NYSE"   },
  { ticker: "DLTR",  name: "Dollar Tree",              exchange: "NASDAQ" },
  { ticker: "DG",    name: "Dollar General",           exchange: "NYSE"   },
  { ticker: "SFM",   name: "Sprouts Farmers Market",   exchange: "NASDAQ" },
  // ── Energy ────────────────────────────────────────────────────────────────
  { ticker: "XOM",   name: "ExxonMobil",               exchange: "NYSE"   },
  { ticker: "CVX",   name: "Chevron",                  exchange: "NYSE"   },
  { ticker: "COP",   name: "ConocoPhillips",           exchange: "NYSE"   },
  { ticker: "EOG",   name: "EOG Resources",            exchange: "NYSE"   },
  { ticker: "PXD",   name: "Pioneer Natural Resources",exchange: "NYSE"   },
  { ticker: "OXY",   name: "Occidental Petroleum",     exchange: "NYSE"   },
  { ticker: "SLB",   name: "SLB (Schlumberger)",       exchange: "NYSE"   },
  { ticker: "HAL",   name: "Halliburton",              exchange: "NYSE"   },
  { ticker: "BKR",   name: "Baker Hughes",             exchange: "NASDAQ" },
  { ticker: "MPC",   name: "Marathon Petroleum",       exchange: "NYSE"   },
  { ticker: "PSX",   name: "Phillips 66",              exchange: "NYSE"   },
  { ticker: "VLO",   name: "Valero Energy",            exchange: "NYSE"   },
  { ticker: "DVN",   name: "Devon Energy",             exchange: "NYSE"   },
  { ticker: "HES",   name: "Hess",                     exchange: "NYSE"   },
  { ticker: "APA",   name: "APA Corporation",          exchange: "NASDAQ" },
  { ticker: "EQT",   name: "EQT Corporation",          exchange: "NYSE"   },
  { ticker: "RRC",   name: "Range Resources",          exchange: "NYSE"   },
  { ticker: "AR",    name: "Antero Resources",         exchange: "NYSE"   },
  { ticker: "CTRA",  name: "Coterra Energy",           exchange: "NYSE"   },
  { ticker: "WMB",   name: "Williams Companies",       exchange: "NYSE"   },
  { ticker: "KMI",   name: "Kinder Morgan",            exchange: "NYSE"   },
  { ticker: "OKE",   name: "ONEOK",                    exchange: "NYSE"   },
  { ticker: "ET",    name: "Energy Transfer LP",       exchange: "NYSE"   },
  { ticker: "EPD",   name: "Enterprise Products",      exchange: "NYSE"   },
  { ticker: "MPLX",  name: "MPLX LP",                  exchange: "NYSE"   },
  // ── Industrials ───────────────────────────────────────────────────────────
  { ticker: "GE",    name: "GE Aerospace",             exchange: "NYSE"   },
  { ticker: "HON",   name: "Honeywell",                exchange: "NASDAQ" },
  { ticker: "MMM",   name: "3M",                       exchange: "NYSE"   },
  { ticker: "RTX",   name: "RTX (Raytheon)",           exchange: "NYSE"   },
  { ticker: "LMT",   name: "Lockheed Martin",          exchange: "NYSE"   },
  { ticker: "NOC",   name: "Northrop Grumman",         exchange: "NYSE"   },
  { ticker: "GD",    name: "General Dynamics",         exchange: "NYSE"   },
  { ticker: "L3H",   name: "L3Harris Technologies",    exchange: "NYSE"   },
  { ticker: "TDG",   name: "TransDigm Group",          exchange: "NYSE"   },
  { ticker: "HWM",   name: "Howmet Aerospace",         exchange: "NYSE"   },
  { ticker: "BA",    name: "Boeing",                   exchange: "NYSE"   },
  { ticker: "CAT",   name: "Caterpillar",              exchange: "NYSE"   },
  { ticker: "DE",    name: "Deere & Company",          exchange: "NYSE"   },
  { ticker: "EMR",   name: "Emerson Electric",         exchange: "NYSE"   },
  { ticker: "ETN",   name: "Eaton",                    exchange: "NYSE"   },
  { ticker: "PH",    name: "Parker-Hannifin",          exchange: "NYSE"   },
  { ticker: "DOV",   name: "Dover",                    exchange: "NYSE"   },
  { ticker: "ITW",   name: "Illinois Tool Works",      exchange: "NASDAQ" },
  { ticker: "AME",   name: "AMETEK",                   exchange: "NYSE"   },
  { ticker: "ROK",   name: "Rockwell Automation",      exchange: "NYSE"   },
  { ticker: "IR",    name: "Ingersoll Rand",           exchange: "NYSE"   },
  { ticker: "GWW",   name: "W.W. Grainger",            exchange: "NYSE"   },
  { ticker: "FAST",  name: "Fastenal",                 exchange: "NASDAQ" },
  { ticker: "CHRW",  name: "C.H. Robinson",            exchange: "NASDAQ" },
  // ── Transportation ────────────────────────────────────────────────────────
  { ticker: "UPS",   name: "UPS",                      exchange: "NYSE"   },
  { ticker: "FDX",   name: "FedEx",                    exchange: "NYSE"   },
  { ticker: "CSX",   name: "CSX",                      exchange: "NASDAQ" },
  { ticker: "UNP",   name: "Union Pacific",            exchange: "NYSE"   },
  { ticker: "NSC",   name: "Norfolk Southern",         exchange: "NYSE"   },
  { ticker: "CP",    name: "Canadian Pacific Kansas City", exchange: "NYSE"},
  { ticker: "CNI",   name: "Canadian National Railway",exchange: "NYSE"   },
  { ticker: "UAL",   name: "United Airlines",          exchange: "NASDAQ" },
  { ticker: "DAL",   name: "Delta Air Lines",          exchange: "NYSE"   },
  { ticker: "LUV",   name: "Southwest Airlines",       exchange: "NYSE"   },
  { ticker: "AAL",   name: "American Airlines",        exchange: "NASDAQ" },
  { ticker: "ALK",   name: "Alaska Air Group",         exchange: "NYSE"   },
  { ticker: "ODFL",  name: "Old Dominion Freight",     exchange: "NASDAQ" },
  { ticker: "SAIA",  name: "Saia Inc",                 exchange: "NASDAQ" },
  { ticker: "XPO",   name: "XPO",                      exchange: "NYSE"   },
  { ticker: "WERN",  name: "Werner Enterprises",       exchange: "NASDAQ" },
  // ── Materials ─────────────────────────────────────────────────────────────
  { ticker: "FCX",   name: "Freeport-McMoRan",         exchange: "NYSE"   },
  { ticker: "NEM",   name: "Newmont",                  exchange: "NYSE"   },
  { ticker: "GOLD",  name: "Barrick Gold",             exchange: "NYSE"   },
  { ticker: "AA",    name: "Alcoa",                    exchange: "NYSE"   },
  { ticker: "STLD",  name: "Steel Dynamics",           exchange: "NASDAQ" },
  { ticker: "NUE",   name: "Nucor",                    exchange: "NYSE"   },
  { ticker: "RS",    name: "Reliance Steel",           exchange: "NYSE"   },
  { ticker: "MLM",   name: "Martin Marietta Materials",exchange: "NYSE"   },
  { ticker: "VMC",   name: "Vulcan Materials",         exchange: "NYSE"   },
  { ticker: "ECL",   name: "Ecolab",                   exchange: "NYSE"   },
  { ticker: "SHW",   name: "Sherwin-Williams",         exchange: "NYSE"   },
  { ticker: "RPM",   name: "RPM International",        exchange: "NYSE"   },
  { ticker: "PPG",   name: "PPG Industries",           exchange: "NYSE"   },
  { ticker: "APD",   name: "Air Products",             exchange: "NYSE"   },
  { ticker: "LIN",   name: "Linde",                    exchange: "NASDAQ" },
  { ticker: "DD",    name: "DuPont",                   exchange: "NYSE"   },
  { ticker: "DOW",   name: "Dow Inc",                  exchange: "NYSE"   },
  { ticker: "LYB",   name: "LyondellBasell",           exchange: "NYSE"   },
  { ticker: "CE",    name: "Celanese",                 exchange: "NYSE"   },
  { ticker: "EMN",   name: "Eastman Chemical",         exchange: "NYSE"   },
  // ── Utilities ─────────────────────────────────────────────────────────────
  { ticker: "NEE",   name: "NextEra Energy",           exchange: "NYSE"   },
  { ticker: "DUK",   name: "Duke Energy",              exchange: "NYSE"   },
  { ticker: "SO",    name: "Southern Company",         exchange: "NYSE"   },
  { ticker: "D",     name: "Dominion Energy",          exchange: "NYSE"   },
  { ticker: "EXC",   name: "Exelon",                   exchange: "NASDAQ" },
  { ticker: "AEP",   name: "American Electric Power",  exchange: "NASDAQ" },
  { ticker: "ED",    name: "Consolidated Edison",      exchange: "NYSE"   },
  { ticker: "WEC",   name: "WEC Energy Group",         exchange: "NYSE"   },
  { ticker: "XEL",   name: "Xcel Energy",              exchange: "NASDAQ" },
  { ticker: "AWK",   name: "American Water Works",     exchange: "NYSE"   },
  { ticker: "PPL",   name: "PPL Corporation",          exchange: "NYSE"   },
  { ticker: "FE",    name: "FirstEnergy",              exchange: "NYSE"   },
  { ticker: "ETR",   name: "Entergy",                  exchange: "NYSE"   },
  { ticker: "ENPH",  name: "Enphase Energy",           exchange: "NASDAQ" },
  { ticker: "FSLR",  name: "First Solar",              exchange: "NASDAQ" },
  { ticker: "RUN",   name: "Sunrun",                   exchange: "NASDAQ" },
  // ── Real Estate ───────────────────────────────────────────────────────────
  { ticker: "AMT",   name: "American Tower",           exchange: "NYSE"   },
  { ticker: "PLD",   name: "Prologis",                 exchange: "NYSE"   },
  { ticker: "EQIX",  name: "Equinix",                  exchange: "NASDAQ" },
  { ticker: "CCI",   name: "Crown Castle",             exchange: "NYSE"   },
  { ticker: "SPG",   name: "Simon Property Group",     exchange: "NYSE"   },
  { ticker: "O",     name: "Realty Income",            exchange: "NYSE"   },
  { ticker: "WPC",   name: "W. P. Carey",              exchange: "NYSE"   },
  { ticker: "DLR",   name: "Digital Realty",           exchange: "NYSE"   },
  { ticker: "PSA",   name: "Public Storage",           exchange: "NYSE"   },
  { ticker: "EQR",   name: "Equity Residential",       exchange: "NYSE"   },
  { ticker: "AVB",   name: "AvalonBay Communities",    exchange: "NYSE"   },
  { ticker: "VICI",  name: "VICI Properties",          exchange: "NYSE"   },
  { ticker: "GLPI",  name: "Gaming & Leisure Properties",exchange: "NASDAQ"},
  { ticker: "IRM",   name: "Iron Mountain",            exchange: "NYSE"   },
  // ── Mining / Bitcoin ──────────────────────────────────────────────────────
  { ticker: "CLSK",  name: "CleanSpark",               exchange: "NASDAQ" },
  { ticker: "RIOT",  name: "Riot Platforms",           exchange: "NASDAQ" },
  { ticker: "MARA",  name: "Marathon Digital",         exchange: "NASDAQ" },
  { ticker: "HUT",   name: "Hut 8 Corp",               exchange: "NASDAQ" },
];

// ─── 1단계: 마스터 리스트 → DB 동기화 ────────────────────────────────────────
export async function syncUsList(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const stock of US_MASTER_LIST) {
    const res = await pool.query(
      `INSERT INTO us_stocks (ticker, name, exchange)
       VALUES ($1, $2, $3)
       ON CONFLICT (ticker) DO NOTHING`,
      [stock.ticker, stock.name, stock.exchange]
    );
    if ((res.rowCount ?? 0) > 0) inserted++;
  }
  console.log(`[us-full] 종목 목록 동기화: ${inserted}개 신규 추가 (전체 ${US_MASTER_LIST.length}개)`);
  return { inserted, total: US_MASTER_LIST.length };
}

// ─── 2단계: Yahoo Finance 재무 데이터 수집 ────────────────────────────────────
interface StockMetrics {
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  market_cap: number | null;
  current_price: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  opm: number | null;
  rev_growth: number | null;
  revenue: number | null;
  net_income: number | null;
  shares_out: number | null;
  beta: number | null;
  week52_high: number | null;
  week52_low: number | null;
}

async function fetchMetrics(ticker: string): Promise<StockMetrics | null> {
  try {
    const summary = await yahoo.quoteSummary(ticker, {
      modules: ["price", "financialData", "defaultKeyStatistics", "summaryProfile"],
    });
    const p  = summary.price;
    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    const sp = summary.summaryProfile as any;

    const industry = sp?.industry ?? null;
    const sector   = industry ? classifySector(industry, "US") : null;

    return {
      sector,
      industry,
      exchange:      p?.exchangeName ?? null,
      market_cap:    p?.marketCap              ?? null,
      current_price: p?.regularMarketPrice     ?? null,
      per:           ks?.trailingEps != null && p?.regularMarketPrice != null
                       ? p.regularMarketPrice / ks.trailingEps
                       : null,
      pbr:           ks?.priceToBook           ?? null,
      roe:           fd?.returnOnEquity != null  ? fd.returnOnEquity * 100  : null,
      opm:           fd?.operatingMargins != null ? fd.operatingMargins * 100 : null,
      rev_growth:    fd?.revenueGrowth != null    ? fd.revenueGrowth * 100   : null,
      revenue:       fd?.totalRevenue            ?? null,
      net_income:    fd?.netIncomeToCommon       ?? null,
      shares_out:    ks?.sharesOutstanding       ?? null,
      beta:          ks?.beta                    ?? null,
      week52_high:   p?.fiftyTwoWeekHigh         ?? null,
      week52_low:    p?.fiftyTwoWeekLow          ?? null,
    };
  } catch {
    return null;
  }
}

// ─── 3단계: 미수집 종목 일괄 처리 ────────────────────────────────────────────
export async function fetchUsPending(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { rows: pending } = await pool.query<{ ticker: string }>(
    `SELECT ticker FROM us_stocks
     WHERE (data_fetched = false OR last_updated < $1)
     ORDER BY last_updated ASC NULLS FIRST
     LIMIT $2`,
    [cutoff, BATCH_LIMIT]
  );

  if (pending.length === 0) {
    console.log("[us-full] 수집 대기 종목 없음");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[us-full] Yahoo Finance 수집 시작: ${pending.length}개`);

  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async ({ ticker }) => {
        const metrics = await fetchMetrics(ticker);

        if (metrics) {
          await pool.query(
            `UPDATE us_stocks SET
               sector        = $2,
               industry      = $3,
               exchange      = COALESCE($4, exchange),
               market_cap    = $5,
               current_price = $6,
               per           = $7,
               pbr           = $8,
               roe           = $9,
               opm           = $10,
               rev_growth    = $11,
               revenue       = $12,
               net_income    = $13,
               shares_out    = $14,
               beta          = $15,
               week52_high   = $16,
               week52_low    = $17,
               data_fetched  = true,
               fetch_error   = NULL,
               last_updated  = NOW()
             WHERE ticker = $1`,
            [
              ticker,
              metrics.sector,
              metrics.industry,
              metrics.exchange,
              metrics.market_cap,
              metrics.current_price,
              metrics.per,
              metrics.pbr,
              metrics.roe,
              metrics.opm,
              metrics.rev_growth,
              metrics.revenue,
              metrics.net_income,
              metrics.shares_out,
              metrics.beta,
              metrics.week52_high,
              metrics.week52_low,
            ]
          );
          succeeded++;
        } else {
          await pool.query(
            `UPDATE us_stocks SET
               data_fetched = true,
               fetch_error  = 'yahoo_no_data',
               last_updated = NOW()
             WHERE ticker = $1`,
            [ticker]
          );
          failed++;
        }
      })
    );

    if (i + CONCURRENCY < pending.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= pending.length) {
      console.log(
        `[us-full] 진행: ${Math.min(i + CONCURRENCY, pending.length)}/${pending.length} ` +
        `(성공 ${succeeded}, 실패 ${failed})`
      );
    }
  }

  console.log(`[us-full] 완료 — 성공 ${succeeded}, 실패 ${failed} / 전체 ${pending.length}`);
  return { processed: pending.length, succeeded, failed };
}

// ─── 메인 진입점 ──────────────────────────────────────────────────────────────
export async function runUsFullHarvest(): Promise<void> {
  try {
    await syncUsList();
    await fetchUsPending();
  } catch (e: any) {
    console.error("[us-full] 오류:", e?.message);
  }
}
