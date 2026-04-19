import React, { createContext, useContext, useState, useEffect } from "react";

/**
 * Three-way theme cycle: light → dark → coder.
 *
 * "Coder Mode" is a soft-blue, low-contrast palette intended for agents with
 * sensitive eyes (long shifts, post-migraine, photophobia). It removes the
 * warm cream/coral notes of light mode and the deep brown of dark mode in
 * favour of muted slate-blue surfaces and a high-but-gentle text contrast
 * (~#dbeaff on #0e1a2b).
 *
 * Implemented as a `.coder` class on <html> so existing semantic tokens
 * (--background, --foreground, --primary, etc.) keep working — no component
 * changes needed beyond the cycle button.
 */
type Theme = "light" | "dark" | "coder";

const THEME_ORDER: readonly Theme[] = ["light", "dark", "coder"] as const;

interface ThemeContextType {
  theme: Theme;
  /** Cycle to the next theme: light → dark → coder → light. */
  toggleTheme: () => void;
  /** Jump straight to a specific theme (used by the Settings tri-toggle). */
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "dark" || stored === "coder" || stored === "light") return stored;
  } catch {
    /* ignore */
  }
  return "light";
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    // Mutually exclusive — clear all then re-apply so an old class never
    // bleeds into the new theme.
    root.classList.remove("dark", "coder");
    if (theme === "dark") root.classList.add("dark");
    if (theme === "coder") root.classList.add("coder");
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((current) => {
      const idx = THEME_ORDER.indexOf(current);
      return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    });
  };

  const setTheme = (next: Theme) => setThemeState(next);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
