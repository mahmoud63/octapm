import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useMaterialTestActions, useMaterialTests } from '@/api/quality-hooks'
import { useActivities } from '@/api/record-hooks'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { PickerField } from '@/components/PickerField'
import { PromptSheet } from '@/components/PromptSheet'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, KPI, RecordRow, SkeletonList, Text, spacing } from '@/design-system'
import { useNavigateAfterClose } from '@/navigation/useNavigateAfterClose'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, dueState, humanise } from '@/utilities/format'

/** Material tests: pending first, then by result; a new test is scheduled from here. */
export default function MaterialTestsScreen() {
  const router = useRouter()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const tests = useMaterialTests(projectId)
  const activities = useActivities(projectId)
  const actions = useMaterialTestActions(projectId ?? '')
  const [result, setResult] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const [adding, setAdding] = useState(false)
  const [activityId, setActivityId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const openAfterClose = useNavigateAfterClose(adding)

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase()
    const order = { pending: 0, fail: 1, pass: 2 } as Record<string, number>
    return (tests.data?.rows ?? [])
      .filter((t) => (result ? t.result === result : true))
      .filter((t) => !q || [t.ref, t.testType, t.labName].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => (order[a.result] ?? 3) - (order[b.result] ?? 3))
  }, [tests.data, result, term])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const summary = tests.data?.summary

  if (!projectId) {
    return (
      <Screen testID="screen-tests">
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  const create = async (testType: string) => {
    setFailure(null)
    try {
      const created = await actions.create.mutateAsync({ testType, activityId: activityId ?? undefined })
      setAdding(false)
      openAfterClose(`/quality/tests/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <>
      <Screen scroll={false} testID="screen-tests">
        <FlatList
          data={rows}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.header}>
              {permissions.allows('inspection', 'create') ? (
                <View style={styles.stack}>
                  <PickerField label="Activity for a new test" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="tests-activity" />
                  <Button title="Schedule a test" onPress={() => setAdding(true)} testID="tests-new" />
                </View>
              ) : null}
              <View style={styles.kpis}>
                <KPI label="Pending" value={String(summary?.pending ?? '—')} onPress={() => setResult('pending')} />
                <KPI label="Passed" value={String(summary?.passed ?? '—')} tone="success" onPress={() => setResult('pass')} />
                <KPI label="Failed" value={String(summary?.failed ?? '—')} tone={(summary?.failed ?? 0) > 0 ? 'error' : 'default'} onPress={() => setResult('fail')} />
              </View>
              <Input label="Find" placeholder="Reference, test or lab" value={term} onChangeText={setTerm} autoCapitalize="none" returnKeyType="search" testID="tests-search" />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                <FilterChip label="All" selected={result === null} onPress={() => setResult(null)} testID="tests-chip-all" />
                {['pending', 'pass', 'fail'].map((r) => (
                  <FilterChip key={r} label={humanise(r)} selected={result === r} onPress={() => setResult(result === r ? null : r)} testID={`tests-chip-${r}`} />
                ))}
              </ScrollView>
              <Freshness updatedAt={tests.dataUpdatedAt || undefined} isFetching={tests.isFetching} />
              {failure ? (
                <Text variant="caption" tone="error" accessibilityRole="alert">
                  {failure}
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const state = item.dueDate && item.result === 'pending' ? dueState(item.dueDate) : null
            return (
              <RecordRow
                reference={item.ref}
                title={item.testType}
                status={item.result === 'pass' ? 'passed' : item.result === 'fail' ? 'failed' : 'pending'}
                meta={[item.labName, item.testDate ? `Tested ${day(item.testDate)}` : item.dueDate ? `Due ${day(item.dueDate)}` : null, item.activityLinks[0]?.activity?.name].filter(Boolean).join(' · ')}
                trailing={state?.label}
                trailingTone={state?.tone ?? 'muted'}
                onPress={() => router.push(`/quality/tests/${item.id}`)}
                testID={`test-row-${item.id}`}
              />
            )
          }}
          ListEmptyComponent={
            tests.isPending ? (
              <SkeletonList rows={4} />
            ) : tests.isError ? (
              <ErrorState message={userMessage(tests.error)} onRetry={() => void tests.refetch()} />
            ) : (
              <EmptyState title="No material tests match" />
            )
          }
          onRefresh={() => void tests.refetch()}
          refreshing={false}
          contentContainerStyle={styles.list}
        />
      </Screen>
      <PromptSheet visible={adding} title="Schedule a material test" label="Test" required placeholder="e.g. 28-day concrete cube, pad pour 2" confirmTitle="Schedule" busy={actions.create.isPending} error={failure} onCancel={() => setAdding(false)} onConfirm={(t) => void create(t)} testID="prompt-test" />
    </>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  stack: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
})
