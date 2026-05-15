import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "crm_theme";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try { return (localStorage.getItem(KEY) as Theme) ?? "dark"; } catch { return "dark"; }
}

export function useTheme() {
  // Start with "dark" to match SSR; useEffect corrects to actual saved preference
  const [theme, setThemeState] = useState<Theme>("dark");

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(KEY, t); } catch {}
    document.documentElement.classList.toggle("dark", t === "dark");
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    const actual = readTheme();
    setThemeState(actual);
    document.documentElement.classList.toggle("dark", actual === "dark");
  }, []);

  return { theme, toggle };
}
