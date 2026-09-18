import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { queryClient } from '@/api/query'

/** Render a screen the way the app does: inside the shared query client. */
export const renderScreen = (ui: ReactElement) => render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
