import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { darkTheme, lightTheme, type Theme } from './tokens'

const ThemeContext = createContext<Theme>(lightTheme)

export function ThemeProvider({ children, force }: { children: ReactNode; force?: 'light' | 'dark' }) {
  const system = useColorScheme()
  const theme = useMemo(() => ((force ?? system) === 'dark' ? darkTheme : lightTheme), [force, system])
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export const useTheme = (): Theme => useContext(ThemeContext)
