import { create } from 'zustand'

/**
 * The one Ask OctaPM drawer (AI UX correction, 2026-10-11): opened from the
 * header or from an AI action on any screen, over that screen. An action
 * may name the record it is about and a question to ask straight away.
 */
export interface AiRecordContext {
  recordType: string
  recordId: string
  /** What the reader sees, e.g. "RFI-102" or "A-200 Concrete frame". */
  label: string
}

interface AiDrawerState {
  open: boolean
  record: AiRecordContext | null
  /** Asked as soon as the drawer opens. */
  question: string | null
  /** Bumped on every open so the drawer starts a new question. */
  requestId: number
  openDrawer: (options?: { record?: AiRecordContext | null; question?: string | null }) => void
  setOpen: (open: boolean) => void
  clearQuestion: () => void
}

export const useAiDrawer = create<AiDrawerState>()((set) => ({
  open: false,
  record: null,
  question: null,
  requestId: 0,
  openDrawer: (options = {}) =>
    set((state) => ({
      open: true,
      record: options.record ?? null,
      question: options.question ?? null,
      requestId: state.requestId + 1,
    })),
  setOpen: (open) => set(open ? { open } : { open, record: null, question: null }),
  clearQuestion: () => set({ question: null }),
}))
