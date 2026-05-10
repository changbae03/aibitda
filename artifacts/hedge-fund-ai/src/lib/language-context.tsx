import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getApiUrl } from "@/lib/utils";

type Language = "ko" | "en";

interface LanguageContextValue {
  language: Language;
  isEn: boolean;
  setLanguage: (lang: Language) => Promise<void>;
}

const LS_KEY = "aibitda-lang";

const LanguageContext = createContext<LanguageContextValue>({
  language: "ko",
  isEn: false,
  setLanguage: async () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored === "en" || stored === "ko") return stored;
    } catch {}
    return "ko";
  });

  useEffect(() => {
    fetch(getApiUrl("/api/user/settings"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.language === "en" || d?.language === "ko") {
          setLanguageState(d.language);
          try { localStorage.setItem(LS_KEY, d.language); } catch {}
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = async (lang: Language) => {
    setLanguageState(lang);
    try { localStorage.setItem(LS_KEY, lang); } catch {}
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
