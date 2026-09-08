/**
 * A journey recorder.
 *
 * The UX questions — how many steps, how many dialogs, what did the user have
 * to retype — are answered by the drive itself rather than by someone's
 * impression of it afterwards. Each persona's journey is emitted as one JSON
 * line, which the report is built from.
 */

export type FrictionKind =
  | 'unclear-label'
  | 'unclear-next-action'
  | 'missing-status'
  | 'missing-ball-in-court'
  | 'missing-notification'
  | 'permission'
  | 'error'
  | 'state-loss'
  | 'navigation'

export interface DuplicateEntry {
  /** UX-DUP-SUB-001 and friends. */
  id: string
  field: string
  /** Where the system already held this value. */
  alreadyKnownFrom: string
  note?: string
}

export class Journey {
  readonly steps: string[] = []
  readonly dialogs: string[] = []
  readonly typedValues: Array<{ field: string; value: string }> = []
  readonly inheritedValues: Array<{ field: string; from: string }> = []
  readonly duplicates: DuplicateEntry[] = []
  readonly frictions: Array<{ kind: FrictionKind; note: string }> = []
  readonly navigations: string[] = []

  constructor(
    readonly persona: string,
    readonly goal: string,
    readonly startingPage: string,
  ) {}

  /** A major step: something the user would describe as a thing they did. */
  step(name: string) {
    this.steps.push(name)
    return this
  }

  dialog(name: string) {
    this.dialogs.push(name)
    return this
  }

  /** A value the user had to enter by hand. */
  typed(field: string, value: string | number) {
    this.typedValues.push({ field, value: String(value) })
    return this
  }

  /** A value that arrived on its own, from a record the system already had. */
  inherited(field: string, from: string) {
    this.inheritedValues.push({ field, from })
    return this
  }

  /** Something the user had to retype that the system already knew. */
  duplicate(entry: DuplicateEntry) {
    this.duplicates.push(entry)
    return this
  }

  friction(kind: FrictionKind, note: string) {
    this.frictions.push({ kind, note })
    return this
  }

  /** A move to a different page or module mid-task. */
  navigate(where: string) {
    this.navigations.push(where)
    return this
  }

  /** One line the report can be built from. */
  emit() {
    // eslint-disable-next-line no-console
    console.log(
      `UX_JOURNEY ${JSON.stringify({
        persona: this.persona,
        goal: this.goal,
        startingPage: this.startingPage,
        majorSteps: this.steps.length,
        stepList: this.steps,
        dialogs: this.dialogs.length,
        dialogList: this.dialogs,
        manuallyEntered: this.typedValues.length,
        typedList: this.typedValues.map((t) => t.field),
        inherited: this.inheritedValues.length,
        inheritedList: this.inheritedValues,
        navigations: this.navigations.length,
        navigationList: this.navigations,
        duplicates: this.duplicates,
        frictions: this.frictions,
      })}`,
    )
  }
}

/** Emits a named observation the report can quote. */
export const observe = (tag: string, value: unknown) => {
  // eslint-disable-next-line no-console
  console.log(`UX_OBSERVE ${tag} ${JSON.stringify(value)}`)
}
