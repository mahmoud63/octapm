import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useMaterialTestActions, useMaterialTests } from '@/api/quality-hooks'
import { ActionBar, type RecordAction } from '@/components/ActionBar'
import { AttachmentList } from '@/components/AttachmentList'
import { FilterChip } from '@/components/FilterChip'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Fact } from '@/components/WorkflowRecordCard'
import { Button, Card, ErrorState, Input, SkeletonList, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day } from '@/utilities/format'

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** One material test: the spec against the result, and the result recorded from the lab report. */
export default function MaterialTestScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const tests = useMaterialTests(projectId)
  const actions = useMaterialTestActions(projectId ?? '')
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<'pass' | 'fail' | 'pending'>('pass')
  const [actual, setActual] = useState('')
  const [testDate, setTestDate] = useState(today())
  const [lab, setLab] = useState('')
  const [notes, setNotes] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const record = useMemo(() => tests.data?.rows.find((t) => t.id === id) ?? null, [tests.data, id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-test">
        <ErrorState message="Choose a project to open this test." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (tests.isPending) {
    return (
      <Screen testID="screen-test">
        <SkeletonList rows={4} />
      </Screen>
    )
  }
  if (tests.isError || !record) {
    return (
      <Screen testID="screen-test">
        <ErrorState message={tests.isError ? userMessage(tests.error) : 'This test is no longer available.'} onRetry={() => void tests.refetch()} />
      </Screen>
    )
  }

  const canRecord = permissions.allows('inspection', 'update')
  const save = async () => {
    setFailure(null)
    try {
      await actions.record.mutateAsync({ testId: record.id, body: { result, actualValue: actual.trim() || undefined, testDate: isoDay.test(testDate) ? testDate : undefined, labName: lab.trim() || undefined, notes: notes.trim() || undefined } })
      setRecording(false)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  const bar: RecordAction[] = []
  if (canRecord && !recording) bar.push({ id: 'record', title: record.result === 'pending' ? 'Record result' : 'Change result', variant: 'primary', onPress: () => setRecording(true) })
  const activityNames = record.activityLinks.map((l) => l.activity?.name).filter(Boolean).join(', ') || null
  const hasFacts = !!(record.specValue || record.actualValue || record.millCertRef || record.notes || activityNames)

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-test">
        <RecordHeader reference={record.ref} title={record.testType} status={record.result === 'pass' ? 'passed' : record.result === 'fail' ? 'failed' : 'pending'} meta={[record.labName, record.testDate ? `Tested ${day(record.testDate)}` : record.dueDate ? `Due ${day(record.dueDate)}` : null].filter((v): v is string => !!v)} testID="test-header" />
        {hasFacts ? (
          <Card>
            <View style={styles.stack}>
              <Fact label="Specified" value={record.specValue} />
              <Fact label="Actual" value={record.actualValue} />
              <Fact label="Mill certificate" value={record.millCertRef} />
              <Fact label="Notes" value={record.notes} />
              <Fact label="Activity" value={activityNames} />
            </View>
          </Card>
        ) : (
          <Text tone="muted">No result yet. Record it when the lab report is in.</Text>
        )}
        {recording ? (
          <Card>
            <View style={styles.stack}>
              <Text variant="label" label tone="muted">
                Result
              </Text>
              <View style={styles.chips}>
                {(['pass', 'fail', 'pending'] as const).map((r) => (
                  <FilterChip key={r} label={r === 'pass' ? 'Passed' : r === 'fail' ? 'Failed' : 'Pending'} selected={result === r} onPress={() => setResult(r)} testID={`test-result-${r}`} />
                ))}
              </View>
              <Input label="Actual value" value={actual} onChangeText={setActual} placeholder={record.specValue ? `Specified ${record.specValue}` : 'As reported by the lab'} testID="test-actual" />
              <Input label="Test date" value={testDate} onChangeText={setTestDate} placeholder="YYYY-MM-DD" autoCapitalize="none" error={testDate && !isoDay.test(testDate) ? 'Use the form YYYY-MM-DD' : undefined} testID="test-date" />
              <Input label="Laboratory" value={lab} onChangeText={setLab} testID="test-lab" />
              <Input label="Notes" value={notes} onChangeText={setNotes} multiline testID="test-notes" />
              {failure ? (
                <Text variant="caption" tone="error" accessibilityRole="alert">
                  {failure}
                </Text>
              ) : null}
              <Button title="Save result" size="lg" fullWidth loading={actions.record.isPending} onPress={() => void save()} testID="test-save" />
              <Button title="Cancel" variant="ghost" onPress={() => setRecording(false)} />
            </View>
          </Card>
        ) : null}
        <Card>
          <AttachmentList projectId={projectId} recordType="material_test" recordId={record.id} canAdd={canRecord || permissions.allows('inspection', 'submit')} />
        </Card>
      </Screen>
      <ActionBar actions={bar} />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
