import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getApiUrl } from "@/lib/utils";

type Language = "ko" | "en";

interface LanguageContextValue {
  language: Language;
  isEn: boolean;
  setLanguage: (lang: Language) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "ko",
  isEn: false,
  setLanguage: async () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ko");

  useEffect(() => {
    fetch(getApiUrl("/api/user/settings"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.language) setLanguageState(d.language as Language); })
      .catch(() => {});
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    try {
      await fetch(getApiUrl("/api/user/settings"), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: lang }),
      });
    } catch {}
  };

  return (
    <LanguageContext.Provider value={{ language, isEn: language === "en", setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
