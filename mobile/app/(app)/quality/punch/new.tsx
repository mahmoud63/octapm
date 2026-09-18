import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { usePunchActions } from '@/api/quality-hooks'
import { OBSERVATION_TYPES, PUNCH_PRIORITIES } from '@/api/quality-types'
import { useActivities, useLocations, useTeam, useUploadAttachments } from '@/api/record-hooks'
import { useAuthStore } from '@/auth/store'
import { AnnotateSheet } from '@/components/AnnotateSheet'
import { FilterChip } from '@/components/FilterChip'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing } from '@/design-system'
import { captureOrQueue, keepFilesForQueue } from '@/offline/capture'
import { enqueue } from '@/offline/outbox'
import { useProjectStore } from '@/projects/store'
import { humanise } from '@/utilities/format'
import { newId } from '@/utilities/id'

const isoDay = /^\d{4}-\d{2}-\d{2}$/
type Picked = { uri: string; name: string; type: string }

/**
 * A punch item or an observation in the time it takes to point a camera:
 * photo first, then a title, who fixes it and by when. The record is created
 * with a replay key; the photos follow it on the unified attachment route.
 */
export default function NewPunchScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ kind?: string; activityId?: string; locationId?: string; sheetId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const me = useAuthStore((s) => s.user)
  const team = useTeam(projectId)
  const locations = useLocations(projectId)
  const activities = useActivities(projectId)
  const actions = usePunchActions(projectId ?? '')
  const upload = useUploadAttachments(projectId ?? '')
  const [kind, setKind] = useState<'punch' | 'observation'>(params.kind === 'observation' ? 'observation' : 'punch')
  const [observationType, setObservationType] = useState<string | null>(null)
  const [hazard, setHazard] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<string>('normal')
  const [trade, setTrade] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [locationId, setLocationId] = useState<string | null>(params.locationId ?? null)
  const [locationText, setLocationText] = useState('')
  const [activityId, setActivityId] = useState<string | null>(params.activityId ?? null)
  const [dueDate, setDueDate] = useState('')
  const [photos, setPhotos] = useState<Picked[]>([])
  /** Index of the photo being marked up, if any. */
  const [marking, setMarking] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const people = useMemo(() => (team.data ?? []).map((m) => ({ id: m.userId, label: m.name, sublabel: humanise(m.assignmentRole ?? m.orgRole) })), [team.data])
  const places = useMemo(() => (locations.data ?? []).map((l) => ({ id: l.id, label: l.fullName || l.name, sublabel: l.code })), [locations.data])
  const work = useMemo(() => (activities.data ?? []).map((a) => ({ id: a.id, label: a.name, sublabel: [a.activityCode, a.wbsCode].filter(Boolean).join(' · ') })), [activities.data])
  const ready = title.trim().length >= 3 && (kind === 'punch' || !!observationType) && (!dueDate || isoDay.test(dueDate))

  const pick = async (source: 'camera' | 'library') => {
    setFailure(null)
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setFailure('OctaPM needs camera or photo access for this. Turn it on in Settings.')
      return
    }
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true, selectionLimit: 5 })
    if (picked.canceled) return
    setPhotos((prev) => [...prev, ...picked.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `punch-${Date.now()}-${i}.jpg`, type: a.mimeType ?? 'image/jpeg' }))])
  }

  const save = async (status: 'open' | 'draft') => {
    if (!projectId) return
    setFailure(null)
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        kind,
        observationType: kind === 'observation' ? (observationType ?? undefined) : undefined,
        hazard: kind === 'observation' && hazard.trim() ? hazard.trim() : undefined,
        trade: trade.trim() || undefined,
        assigneeUserId: assigneeId ?? undefined,
        managerUserId: me?.id,
        locationId: locationId ?? undefined,
        locationText: locationText.trim() || undefined,
        activityId: activityId ?? undefined,
        sheetId: params.sheetId || undefined,
        dueDate: dueDate || undefined,
        status,
        clientRequestId: newId(),
      }
      const uploadKey = newId()
      // The item carries a replay key, so it is sent now or kept for later; its photos follow it either way.
      const outcome = await captureOrQueue({ projectId, kind: 'punch.create', summary: body.title, payload: { body }, clientRequestId: body.clientRequestId }, () => actions.create.mutateAsync(body))
      if (outcome.queued) {
        if (photos.length) await enqueue({ projectId, kind: 'attachment.upload', summary: `${photos.length} photo${photos.length === 1 ? '' : 's'} for ${body.title}`, payload: { recordType: 'punch_item', recordId: null, role: 'photo', files: await keepFilesForQueue(photos) }, clientRequestId: uploadKey, dependsOn: outcome.queued.id })
        router.replace('/outbox')
        return
      }
      const created = outcome.sent
      if (photos.length) {
        const files = Platform.OS === 'web' ? await Promise.all(photos.map(async (f) => new File([await (await fetch(f.uri)).blob()], f.name, { type: f.type }))) : photos
        await captureOrQueue({ projectId, kind: 'attachment.upload', summary: `${photos.length} photo${photos.length === 1 ? '' : 's'} for ${body.title}`, payload: { recordType: 'punch_item', recordId: created.id, role: 'photo', files: Platform.OS === 'web' ? photos : await keepFilesForQueue(photos) }, clientRequestId: uploadKey }, () => upload.mutateAsync({ recordType: 'punch_item', recordId: created.id, role: 'photo', clientRequestId: uploadKey, files }))
      }
      router.replace(`/quality/punch/${created.id}`)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-punch-new">
        <Text tone="muted">Choose a project first.</Text>
      </Screen>
    )
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-punch-new">
      <Card>
        <View style={styles.stack}>
          <View style={styles.chips}>
            {Platform.OS !== 'web' ? <Button title="Take photo" onPress={() => void pick('camera')} testID="punch-camera" /> : null}
            <Button title={Platform.OS === 'web' ? 'Add photo' : 'Choose photo'} variant="secondary" onPress={() => void pick('library')} testID="punch-library" />
            {photos.length ? <Text tone="muted">{`${photos.length} photo${photos.length === 1 ? '' : 's'} ready`}</Text> : null}
          </View>
          {photos.length ? (
            <View style={styles.chips}>
              {photos.map((file, index) => (
                <Button key={`${file.uri}-${index}`} title={photos.length > 1 ? `Mark up photo ${index + 1}` : file.name.endsWith('-marked.jpg') ? 'Marked up · edit' : 'Mark up photo'} variant="secondary" onPress={() => setMarking(index)} testID={`punch-markup-${index}`} />
              ))}
            </View>
          ) : null}
          <View style={styles.chips}>
            <FilterChip label="Punch item" selected={kind === 'punch'} onPress={() => setKind('punch')} testID="punch-kind-punch" />
            <FilterChip label="Observation" selected={kind === 'observation'} onPress={() => setKind('observation')} testID="punch-kind-observation" />
          </View>
          {kind === 'observation' ? (
            <>
              <View style={styles.chips}>
                {OBSERVATION_TYPES.map((t) => (
                  <FilterChip key={t} label={humanise(t)} selected={observationType === t} onPress={() => setObservationType(t)} testID={`punch-obs-${t}`} />
                ))}
              </View>
              <Input label="Hazard" value={hazard} onChangeText={setHazard} placeholder="e.g. Unprotected edge at level 3" testID="punch-hazard" />
            </>
          ) : null}
          <Input label="Title" required value={title} onChangeText={setTitle} placeholder="What is wrong, in one line" testID="punch-title" />
          <Input label="Description" value={description} onChangeText={setDescription} multiline placeholder="Detail, measurements, what is expected" testID="punch-description" />
          <View style={styles.chips}>
            {PUNCH_PRIORITIES.map((p) => (
              <FilterChip key={p} label={humanise(p)} selected={priority === p} onPress={() => setPriority(p)} testID={`punch-priority-${p}`} />
            ))}
          </View>
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Who and where
          </Text>
          <Input label="Trade" value={trade} onChangeText={setTrade} placeholder="e.g. Carpentry" testID="punch-trade" />
          <PickerField label="Assigned to" options={people} value={assigneeId} onChange={(v) => setAssigneeId(v as string | null)} loading={team.isPending} testID="punch-assignee" />
          <PickerField label="Location" options={places} value={locationId} onChange={(v) => setLocationId(v as string | null)} loading={locations.isPending} testID="punch-location" />
          <Input label="Location detail" value={locationText} onChangeText={setLocationText} placeholder="e.g. Grid B2, north face" testID="punch-location-text" />
          <PickerField label="Activity" options={work} value={activityId} onChange={(v) => setActivityId(v as string | null)} loading={activities.isPending} testID="punch-activity" />
          <Input label="Due" placeholder="YYYY-MM-DD" value={dueDate} onChangeText={setDueDate} autoCapitalize="none" error={dueDate && !isoDay.test(dueDate) ? 'Use the form YYYY-MM-DD' : undefined} testID="punch-due" />
        </View>
      </Card>
      {failure ? (
        <Text tone="error" accessibilityRole="alert" testID="punch-new-failure">
          {failure}
        </Text>
      ) : null}
      <Button title={kind === 'observation' ? 'Raise observation' : 'Raise punch item'} size="lg" fullWidth disabled={!ready} loading={actions.create.isPending || upload.isPending} onPress={() => void save('open')} testID="punch-raise" />
      <Button title="Save as draft" variant="secondary" fullWidth disabled={!ready || actions.create.isPending} onPress={() => void save('draft')} testID="punch-draft" />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
      <AnnotateSheet
        visible={marking !== null}
        photo={marking !== null ? (photos[marking] ?? null) : null}
        onCancel={() => setMarking(null)}
        onConfirm={(marked) => {
          setPhotos((files) => files.map((file, index) => (index === marking ? marked : file)))
          setMarking(null)
        }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
})
