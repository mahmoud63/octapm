import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { isAppError, userMessage } from '@/api/errors'
import { useForm, useFormActions } from '@/api/quality-hooks'
import type { FormInstance, InstanceItem } from '@/api/quality-types'
import { useAuthStore } from '@/auth/store'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { Evidence } from '@/components/Evidence'
import { FilterChip } from '@/components/FilterChip'
import { PromptSheet } from '@/components/PromptSheet'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { SignaturePad } from '@/components/SignaturePad'
import { Badge, Button, Card, ErrorState, Input, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { useNavigateAfterClose } from '@/navigation/useNavigateAfterClose'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

type Answer = { value: string | number | boolean | null; note: string }
type Prompt = { kind: 'close' } | { kind: 'reopen' } | { kind: 'void' } | { kind: 'deficiency'; item: InstanceItem } | null

const optionList = (item: InstanceItem): { value: string; label: string }[] =>
  (item.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: humanise(o) } : { value: o.value, label: o.label }))

/** Which of the server's signature roles a signature item asks for, read from its label; the inspector by default. */
export const signatureRole = (item: Pick<InstanceItem, 'label' | 'inspectionPointType'>): 'inspector' | 'approver' | 'subcontractor' | 'witness' | 'attendee' => {
  const text = `${item.label} ${item.inspectionPointType ?? ''}`.toLowerCase()
  if (text.includes('approver') || text.includes('approval')) return 'approver'
  if (text.includes('subcontractor')) return 'subcontractor'
  if (text.includes('witness')) return 'witness'
  if (text.includes('attendee')) return 'attendee'
  return 'inspector'
}

export const isDeficient = (item: InstanceItem, value: Answer['value']) => {
  if (item.responseType === 'pass_fail') return value === 'fail'
  if (item.responseType === 'yes_no') return value === 'no' || value === false
  return false
}

const initialAnswers = (instance: FormInstance): Record<string, Answer> => {
  const answers: Record<string, Answer> = {}
  for (const section of instance.sections) for (const item of section.items) if (item.response) answers[item.id] = { value: item.response.value, note: item.response.note ?? '' }
  return answers
}

/**
 * The checklist itself. Answers are kept on the device until saved in one
 * request; a failed item can raise a punch item or an observation from
 * right here; completion, closing and reopening go through their routes.
 */
export default function InspectionScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const form = useForm(projectId, id ?? null)
  const actions = useFormActions(projectId ?? '')
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [dirty, setDirty] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [signing, setSigning] = useState<InstanceItem | null>(null)
  const me = useAuthStore((s) => s.user)
  const openAfterClose = useNavigateAfterClose(prompt !== null)

  useEffect(() => {
    if (form.data && !dirty) setAnswers(initialAnswers(form.data))
  }, [form.data, dirty])

  const items = useMemo(() => (form.data?.sections ?? []).flatMap((s) => s.items), [form.data])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-inspection">
        <ErrorState message="Choose a project to open this inspection." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (form.isPending) {
    return (
      <Screen testID="screen-inspection">
        <SkeletonList rows={6} />
      </Screen>
    )
  }
  if (form.isError) {
    return (
      <Screen testID="screen-inspection">
        <ErrorState message={userMessage(form.error)} onRetry={() => void form.refetch()} />
      </Screen>
    )
  }

  const instance = form.data
  const editable = (instance.status === 'scheduled' || instance.status === 'in_progress') && permissions.allows('inspection', 'submit')
  const busy = actions.save.isPending || actions.complete.isPending || actions.act.isPending || actions.start.isPending || actions.deficiency.isPending

  const setAnswer = (itemId: string, patch: Partial<Answer>) => {
    setDirty(true)
    setAnswers((prev) => ({ ...prev, [itemId]: { value: prev[itemId]?.value ?? null, note: prev[itemId]?.note ?? '', ...patch } }))
  }

  const save = async () => {
    setFailure(null)
    setProblems([])
    const responses = Object.entries(answers)
      .filter(([, a]) => a.value !== null && a.value !== '')
      .map(([itemId, a]) => ({ itemId, value: a.value, note: a.note || undefined }))
    try {
      await actions.save.mutateAsync({ instanceId: instance.id, responses })
      setDirty(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const complete = async () => {
    setFailure(null)
    setProblems([])
    try {
      if (dirty) await save()
      await actions.complete.mutateAsync(instance.id)
    } catch (error) {
      if (isAppError(error) && error.serverCode === 'FORM_INCOMPLETE') {
        const details = error.details as { problems?: { label?: string; message?: string; itemId?: string }[] } | undefined
        setProblems((details?.problems ?? []).map((p) => p.message ?? p.label ?? 'An item is incomplete'))
        setFailure('The checklist is not complete yet.')
      } else setFailure(userMessage(error))
    }
  }

  const act = async (action: 'close' | 'reopen' | 'void', reason?: string) => {
    setFailure(null)
    try {
      await actions.act.mutateAsync({ instanceId: instance.id, action, reason })
      setPrompt(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const sign = async (item: InstanceItem, image: string, signerName: string) => {
    setFailure(null)
    try {
      await actions.sign.mutateAsync({ instanceId: instance.id, body: { role: signatureRole(item), image, signerName: signerName || undefined, itemId: item.id } })
      setSigning(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const deficiency = async (item: InstanceItem, description: string, target: 'punch_item' | 'observation') => {
    setFailure(null)
    try {
      const result = await actions.deficiency.mutateAsync({ instanceId: instance.id, itemId: item.id, body: { target, title: item.label, description: description || undefined } })
      setPrompt(null)
      openAfterClose(`/quality/punch/${result.record.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (instance.status === 'scheduled' && permissions.allowsTransition('inspection', 'inspection.start')) bar.push({ id: 'start', title: 'Start', variant: 'primary', busy, onPress: () => void actions.start.mutateAsync(instance.id).catch((e) => setFailure(userMessage(e))) })
  if (editable && dirty) bar.push({ id: 'save', title: 'Save answers', variant: 'primary', busy, onPress: () => void save() })
  if (editable && permissions.allowsTransition('inspection', 'inspection.complete')) bar.push({ id: 'complete', title: 'Complete', variant: dirty ? 'secondary' : 'primary', busy, onPress: () => void complete() })
  if (instance.status === 'complete' && permissions.allowsTransition('inspection', 'inspection.close')) bar.push({ id: 'close', title: 'Close', onPress: () => setPrompt({ kind: 'close' }) })
  if ((instance.status === 'complete' || instance.status === 'closed') && permissions.allowsTransition('inspection', 'inspection.reopen')) bar.push({ id: 'reopen', title: 'Reopen', onPress: () => setPrompt({ kind: 'reopen' }) })
  if (instance.status !== 'void' && instance.status !== 'closed' && permissions.allowsTransition('inspection', 'inspection.void')) bar.push({ id: 'void', title: 'Void', variant: 'danger', onPress: () => setPrompt({ kind: 'void' }) })

  const answered = items.filter((i) => answers[i.id]?.value != null && answers[i.id]?.value !== '').length
  const openHoldPoints = instance.holdPoints.filter((h) => h.state !== 'released' && h.state !== 'passed')

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-inspection">
        <RecordHeader reference={instance.ref} title={instance.title} status={instance.outcome === 'fail' ? 'failed' : instance.status} meta={[instance.typeLabel ?? humanise(instance.type), instance.template?.name, instance.activity?.name, instance.location?.name, instance.dueDate ? `Due ${day(instance.dueDate)}` : null].filter((v): v is string => !!v)} testID="inspection-header" />
        <View style={styles.row}>
          <Badge label={`${answered} of ${items.length} answered`} tone={answered === items.length ? 'success' : 'info'} />
          {instance.outcome ? <Badge label={`Outcome: ${humanise(instance.outcome)}`} tone={instance.outcome === 'pass' ? 'success' : 'error'} /> : null}
          {openHoldPoints.length ? <Badge label={`${openHoldPoints.length} hold point${openHoldPoints.length === 1 ? '' : 's'} open`} tone="warning" /> : null}
        </View>

        {instance.sections.map((section) => (
          <Card key={section.id} testID={`section-${section.id}`}>
            <View style={styles.stack}>
              <Text variant="heading">{section.title}</Text>
              {section.description ? <Text tone="muted">{section.description}</Text> : null}
              {section.items.map((item) => {
                const answer = answers[item.id]
                const value = answer?.value ?? null
                return (
                  <View key={item.id} style={[styles.item, { borderColor: theme.colors.border }]} testID={`item-${item.id}`}>
                    <View style={styles.row}>
                      <Text style={styles.grow}>
                        {item.label}
                        {item.required ? ' *' : ''}
                      </Text>
                      {item.isHoldPoint ? <Badge label="Hold point" tone="warning" /> : null}
                    </View>
                    {item.description ? (
                      <Text variant="caption" tone="muted">
                        {item.description}
                      </Text>
                    ) : null}
                    {item.responseType === 'pass_fail' ? (
                      <View style={styles.chips}>
                        {['pass', 'fail', 'na'].map((v) => (
                          <FilterChip key={v} label={v === 'na' ? 'N/A' : humanise(v)} selected={value === v} onPress={() => editable && setAnswer(item.id, { value: v })} testID={`item-${item.id}-${v}`} />
                        ))}
                      </View>
                    ) : item.responseType === 'yes_no' ? (
                      <View style={styles.chips}>
                        {['yes', 'no'].map((v) => (
                          <FilterChip key={v} label={humanise(v)} selected={value === v} onPress={() => editable && setAnswer(item.id, { value: v })} testID={`item-${item.id}-${v}`} />
                        ))}
                      </View>
                    ) : item.responseType === 'options' ? (
                      <View style={styles.chips}>
                        {optionList(item).map((o) => (
                          <FilterChip key={o.value} label={o.label} selected={value === o.value} onPress={() => editable && setAnswer(item.id, { value: o.value })} testID={`item-${item.id}-${o.value}`} />
                        ))}
                      </View>
                    ) : item.responseType === 'number' ? (
                      <Input label="Value" value={value == null ? '' : String(value)} onChangeText={(t) => setAnswer(item.id, { value: t === '' ? null : Number(t) })} keyboardType="decimal-pad" editable={editable} testID={`item-${item.id}-value`} />
                    ) : item.responseType === 'signature' ? (
                      item.signature ? (
                        <Text variant="caption" tone="muted" testID={`item-${item.id}-signed`}>
                          {`Signed by ${item.signature.signerName ?? 'unknown'} as ${humanise(item.signature.role)} · ${day(item.signature.createdAt)}`}
                        </Text>
                      ) : editable ? (
                        <Button title={`Sign as ${humanise(signatureRole(item))}`} variant="secondary" onPress={() => setSigning(item)} testID={`item-${item.id}-sign`} />
                      ) : (
                        <Text variant="caption" tone="muted">
                          Not signed yet.
                        </Text>
                      )
                    ) : item.responseType === 'photo' ? null : (
                      <Input label="Answer" value={value == null ? '' : String(value)} onChangeText={(t) => setAnswer(item.id, { value: t })} multiline editable={editable} testID={`item-${item.id}-value`} />
                    )}
                    {editable && item.responseType !== 'signature' ? <Input label="Note" value={answer?.note ?? ''} onChangeText={(t) => setAnswer(item.id, { note: t })} testID={`item-${item.id}-note`} /> : answer?.note ? <Text tone="muted">{answer.note}</Text> : null}
                    {(item.photoRequired || item.responseType === 'photo') && item.response?.id ? (
                      <Evidence projectId={projectId} recordType="form_response" recordId={item.response.id} recordRef={instance.ref} locationId={instance.locationId} canAdd={editable} testID={`evidence-${item.response.id}`} />
                    ) : item.photoRequired || item.responseType === 'photo' ? (
                      <Text variant="caption" tone="warning">
                        A photo is required. Save the answers first, then add it here.
                      </Text>
                    ) : null}
                    {editable && isDeficient(item, value) ? <Button title="Raise a punch item for this" variant="secondary" onPress={() => setPrompt({ kind: 'deficiency', item })} testID={`item-${item.id}-deficiency`} /> : null}
                  </View>
                )
              })}
            </View>
          </Card>
        ))}

        {instance.signatures.length ? (
          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Signatures
              </Text>
              {instance.signatures.map((s) => (
                <Text key={s.id}>{`${humanise(s.role)}: ${s.signerName ?? 'signed'} · ${day(s.createdAt)}`}</Text>
              ))}
            </View>
          </Card>
        ) : null}

        {problems.length ? (
          <Card edge={theme.colors.error}>
            <View style={styles.stack}>
              <Text variant="heading" tone="error">
                Still needed
              </Text>
              {problems.map((p, i) => (
                <Text key={i}>• {p}</Text>
              ))}
            </View>
          </Card>
        ) : null}
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="inspection-failure">
            {failure}
          </Text>
        ) : null}
      </Screen>

      <ActionBar actions={bar} />
      <SignaturePad visible={!!signing} title={signing?.label ?? 'Sign'} roleLabel={signing ? humanise(signatureRole(signing)) : ''} defaultName={me?.name} busy={actions.sign.isPending} error={failure} onCancel={() => setSigning(null)} onConfirm={({ image, signerName }) => signing && void sign(signing, image, signerName)} />
      <PromptSheet visible={prompt?.kind === 'close'} title="Close the inspection" label="Reason" confirmTitle="Close" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void act('close', t || undefined)} testID="prompt-close" />
      <PromptSheet visible={prompt?.kind === 'reopen'} title="Reopen the inspection" label="Reason" required confirmTitle="Reopen" busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void act('reopen', t)} testID="prompt-reopen" />
      <PromptSheet visible={prompt?.kind === 'void'} title="Void the inspection" body="A voided inspection is kept but counts for nothing." label="Reason" required confirmTitle="Void" destructive busy={busy} error={failure} onCancel={() => setPrompt(null)} onConfirm={(t) => void act('void', t)} testID="prompt-void" />
      <PromptSheet
        visible={prompt?.kind === 'deficiency'}
        title={prompt?.kind === 'deficiency' ? `Punch item: ${prompt.item.label}` : ''}
        body="Creates a punch item linked to this inspection and this item."
        label="Description"
        placeholder="What is wrong and where"
        confirmTitle="Raise punch item"
        busy={busy}
        error={failure}
        onCancel={() => setPrompt(null)}
        onConfirm={(t) => prompt?.kind === 'deficiency' && void deficiency(prompt.item, t, 'punch_item')}
        testID="prompt-deficiency"
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1 },
})
