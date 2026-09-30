import { useCallback, useMemo, useState } from 'react'
import type { ProjectSetupReadiness } from '../data/schema'
import {
  buildSetupStages,
  currentStageIndex,
  type SetupStage,
} from '../lib/setup-stages'

/**
 * The guided setup's state over the ONE readiness answer the Overview already
 * holds (the useProjectSetupReadiness query): the stages, the current one the
 * engine's statuses and gates point to, and the stage the person is looking
 * at. No request of its own and no polling — every setup mutation
 * invalidates that one query key, and the stages follow.
 */
export function useSetupGuide(readiness: ProjectSetupReadiness | undefined) {
  const stages: SetupStage[] = useMemo(
    () => (readiness ? buildSetupStages(readiness) : []),
    [readiness]
  )
  const currentIndex = stages.length > 0 ? currentStageIndex(stages) : -1
  // The stage chosen on the stepper; until one is chosen, the current stage.
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const chosenIndex = chosenKey ? stages.findIndex((stage) => stage.key === chosenKey) : -1
  const selectedIndex = chosenIndex >= 0 ? chosenIndex : currentIndex

  const select = useCallback((key: string) => setChosenKey(key), [])

  /**
   * Move past a stage. Refused (false) where the stage's gate blocks, exactly
   * as the engine's gate says; a warning never refuses.
   */
  const continueFrom = useCallback(
    (index: number) => {
      const stage = stages[index]
      if (!stage || stage.continueMode === 'block' || stage.continueMode === 'end') {
        return false
      }
      const next = stages[index + 1]
      if (!next) return false
      setChosenKey(next.key)
      return true
    },
    [stages]
  )

  return {
    stages,
    currentIndex,
    selectedIndex,
    selected: selectedIndex >= 0 ? stages[selectedIndex] : null,
    select,
    continueFrom,
  }
}
