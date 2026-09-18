import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useTimesheet, useTimesheetActions } from '@/api/site-hooks'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Card, ErrorState, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

/** One timesheet: who, how long, on what; submitted for approval from here. */
export default function TimesheetScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const timesheet = useTimesheet(projectId, id ?? null)
  const actions = useTimesheetActions(projectId ?? '')
  const [failure, setFailure] = useState<string | null>(null)

  if (!projectId || !id) {
    return (
      <Screen testID="screen-timesheet">
        <ErrorState message="Choose a project to open this timesheet." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (timesheet.isPending) {
    return (
      <Screen testID="screen-timesheet">
        <SkeletonList rows={4} />
      </Screen>
    )
  }
  if (timesheet.isError) {
    return (
      <Screen testID="screen-timesheet">
        <ErrorState message={userMessage(timesheet.error)} onRetry={() => void timesheet.refetch()} />
      </Screen>
    )
  }

  const t = timesheet.data
  const total = t.entries.reduce((sum, e) => sum + (e.hours || 0), 0)
  const bar: RecordAction[] = []
  if ((t.status === 'draft' || t.status === 'rejected') && permissions.allowsTransition('timesheet', 'timesheet.submit')) {
    bar.push({
      id: 'submit',
      title: 'Submit for approval',
      variant: 'primary',
      busy: actions.submit.isPending,
      onPress: () => {
        setFailure(null)
        actions.submit.mutate(t.id, { onError: (error) => setFailure(userMessage(error)) })
      },
    })
  }

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-timesheet">
        <RecordHeader reference={day(`${t.date}T12:00:00`)} title={t.crew?.name ?? 'Timesheet'} status={t.status} meta={[`${t.entries.length} entr${t.entries.length === 1 ? 'y' : 'ies'}`].filter(Boolean)} testID="timesheet-header" />
        <View style={styles.kpis}>
          <KPI label="Hours" value={String(total)} />
          <KPI label="People" value={String(new Set(t.entries.map((e) => e.workerId)).size)} />
        </View>
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Entries
            </Text>
            {t.entries.map((e, index) => (
              <View key={e.id ?? `${e.workerId}-${index}`} style={[styles.row, { borderColor: theme.colors.border }]} testID={`timesheet-entry-${e.id ?? index}`}>
                <Text style={styles.grow}>{e.worker?.name ?? e.workerId}</Text>
                <Text>{`${e.hours} h${e.timeType !== 'regular' ? ` ${humanise(e.timeType)}` : ''}`}</Text>
              </View>
            ))}
            {t.notes ? <Text tone="muted">{t.notes}</Text> : null}
          </View>
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="timesheet-failure">
            {failure}
          </Text>
        ) : null}
        {t.status === 'submitted' ? <Text tone="muted">Submitted; approval happens on the web platform.</Text> : null}
      </Screen>
      <ActionBar actions={bar} />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  grow: { flex: 1 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
