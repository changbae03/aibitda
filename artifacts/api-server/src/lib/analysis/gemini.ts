// Gemini API 클라이언트 + 동시 호출 제한 (429 Rate Limit 방지)
import { GoogleGenAI } from "@google/genai";
import { Semaphore } from "./semaphore.js";

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

// Gemini API 동시 호출 제한: 429 Rate Limit 방지
const MAX_CONCURRENT_GEMINI = 10;
const geminiSemaphore = new Semaphore(MAX_CONCURRENT_GEMINI);

export { geminiApiKey, ai, MAX_CONCURRENT_GEMINI, geminiSemaphore };
