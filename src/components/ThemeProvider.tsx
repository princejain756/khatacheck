"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { applyThemeWithoutFreeze } from "@/lib/display-labels";

type Theme = "light" | "dark";

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const Context = createContext<ThemeCtx>({
  theme: "light",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("khatacheck-theme");
      if (saved === "dark" || saved === "light") {
        applyThemeWithoutFreeze(saved);
        const id = requestAnimationFrame(() => setTheme(saved));
        return () => cancelAnimationFrame(id);
      }
    } catch {
      // ignore storage restrictions
    }
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyThemeWithoutFreeze(next);
    setTheme(next);
    try {
      window.localStorage.setItem("khatacheck-theme", next);
    } catch {
      // ignore
    }
  };

  return <Context.Provider value={{ theme, toggleTheme }}>{children}</Context.Provider>;
}

export function useTheme() {
  return useContext(Context);
}
