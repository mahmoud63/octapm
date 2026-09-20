import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { documentFilePath, uploadAttachments } from '@/api/record-endpoints'
import { useAttachments } from '@/api/record-hooks'
import type { AttachmentItem } from '@/api/record-types'
import { keys, queryClient } from '@/api/query'
import { Button, ErrorState, SkeletonList, Text, radius, spacing, tapTarget, useTheme } from '@/design-system'
import { openApiFile } from '@/files/open'
import { captureOrQueue, keepFilesForQueue } from '@/offline/capture'
import { useOutbox, type OutboxItem } from '@/offline/outbox'
import { relative } from '@/utilities/format'
import { newId } from '@/utilities/id'

const size = (bytes: number | null) => (bytes == null ? '' : bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)

/** What this record is called, for a sentence a person can act on. */
const nameFor = (recordRef: string | null | undefined, recordType: string) => recordRef || recordType.replace(/_/g, ' ')

export interface EvidenceProps {
  projectId: string
  recordType: string
  recordId: string
  /** What the office calls this record — "NCR-012" — for the success sentence. */
  recordRef?: string | null
  /** Where on site, inherited from wherever the person already was. */
  locationId?: string | null
  canAdd: boolean
  /** "Evidence" everywhere; a record with its own word may override. */
  title?: string
  emptyText?: string
  role?: 'attachment' | 'evidence' | 'photo' | 'reference'
  testID?: string
}

/**
 * The evidence on a record, and the one way to add more.
 *
 * This is the whole field-evidence capability: every record type uses this
 * component rather than its own camera. Context is inherited, never typed —
 * the project, the record and the location come from wherever the person
 * already was, so all they add is a caption.
 *
 * Offline, a photograph is kept on the device and queued with a replay key,
 * and it appears here as waiting rather than vanishing into the outbox. When
 * it lands, the person is told which record it reached.
 */
export function Evidence({ projectId, recordType, recordId, recordRef, locationId, canAdd, title = 'Evidence', emptyText = 'No evidence yet.', role = 'photo', testID = 'evidence' }: EvidenceProps) {
  const theme = useTheme()
  const attachments = useAttachments(projectId, recordType, recordId)
  // Select the stable slice and narrow it here: a selector that filters
  // returns a new array on every call, which makes the store's snapshot look
  // changed forever and spins the render loop.
  const outboxItems = useOutbox((s) => s.items)
  const queued = useMemo(
    () => outboxItems.filter((i) => i.kind === 'attachment.upload' && (i.payload as { recordId?: string }).recordId === recordId && i.status !== 'sent'),
    [outboxItems, recordId],
  )
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const open = async (item: AttachmentItem) => {
    if (!item.documentId) return
    setOpening(item.id)
    setFailure(null)
    try {
      await openApiFile(documentFilePath(projectId, item.documentId), item.fileName ?? 'attachment')
    } catch (error) {
      setFailure(userMessage(error))
    } finally {
      setOpening(null)
    }
  }

  const add = async (source: 'camera' | 'library') => {
    setFailure(null)
    setResult(null)
    // Permission is asked for at the moment it is needed, never at launch.
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setFailure(
        permission.canAskAgain
          ? source === 'camera'
            ? 'OctaPM needs the camera to take a photograph. Allow it when asked.'
            : 'OctaPM needs access to your photos to choose one. Allow it when asked.'
          : source === 'camera'
            ? 'Camera access is off for OctaPM. Turn it on in Settings to take a photograph.'
            : 'Photo access is off for OctaPM. Turn it on in Settings to choose a photograph.',
      )
      return
    }
    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: true, selectionLimit: 10 })
    if (picked.canceled || picked.assets.length === 0) return

    const files = picked.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}-${index}.jpg`, type: asset.mimeType ?? 'image/jpeg' }))
    const clientRequestId = newId()
    const name = nameFor(recordRef, recordType)
    setBusy(true)
    try {
      const outcome = await captureOrQueue(
        {
          projectId,
          kind: 'attachment.upload',
          summary: `${files.length === 1 ? 'Photograph' : `${files.length} photographs`} for ${name}`,
          clientRequestId,
          payload: { recordType, recordId, recordRef: recordRef ?? null, role, locationId: locationId ?? null, files: await keepFilesForQueue(files) },
        },
        async () => {
          await uploadAttachments(projectId, {
            recordType,
            recordId,
            role,
            locationId: locationId ?? null,
            clientRequestId,
            files: Platform.OS === 'web' ? await Promise.all(files.map(async (f) => new File([await (await fetch(f.uri)).blob()], f.name, { type: f.type }))) : files,
          })
          return true
        },
      )
      if (outcome.queued) setResult(`Kept on this device — it will be added to ${name} when the signal returns.`)
      else {
        setResult(`${files.length === 1 ? 'Photograph' : `${files.length} photographs`} added to ${name}.`)
        void queryClient.invalidateQueries({ queryKey: keys.projectScoped(projectId, 'attachments', recordType, recordId) })
      }
    } catch (error) {
      setFailure(userMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const stateOf = (item: OutboxItem) =>
    item.status === 'attention' || item.status === 'refused' ? 'Could not be sent' : item.status === 'sending' ? 'Sending…' : 'Waiting to upload'

  return (
    <View style={styles.wrap} testID={testID}>
      <Text variant="label" label tone="muted">
        {title}
      </Text>

      {queued.map((item) => (
        <View key={item.id} style={[styles.row, { borderColor: item.status === 'attention' ? theme.colors.error : theme.colors.warning, backgroundColor: theme.colors.surface }]} testID={`evidence-queued-${item.id}`}>
          <Ionicons name="cloud-upload-outline" size={22} color={item.status === 'attention' ? theme.colors.error : theme.colors.warning} />
          <View style={styles.body}>
            <Text numberOfLines={1}>{item.summary}</Text>
            <Text variant="caption" tone={item.status === 'attention' ? 'error' : 'muted'}>
              {stateOf(item)}
              {item.error?.message ? ` — ${item.error.message}` : ''}
            </Text>
          </View>
        </View>
      ))}

      {attachments.isPending ? (
        <SkeletonList rows={1} />
      ) : attachments.isError ? (
        <ErrorState message={userMessage(attachments.error)} onRetry={() => void attachments.refetch()} />
      ) : attachments.data.length === 0 && queued.length === 0 ? (
        <Text tone="muted">{emptyText}</Text>
      ) : (
        attachments.data.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.fileName ?? 'evidence'}`}
            onPress={() => void open(item)}
            style={({ pressed }) => [styles.row, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
            testID={`attachment-${item.id}`}
          >
            <Ionicons name={item.photo ? 'image-outline' : 'document-outline'} size={22} color={theme.colors.brand} />
            <View style={styles.body}>
              <Text numberOfLines={1}>{item.caption || item.fileName || 'Evidence'}</Text>
              <Text variant="caption" tone="muted">
                {[item.fileName && item.caption ? item.fileName : null, size(item.sizeBytes), relative(item.createdAt)].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {opening === item.id ? (
              <Text variant="caption" tone="muted">
                Opening…
              </Text>
            ) : (
              <Ionicons name="open-outline" size={18} color={theme.colors.textMuted} />
            )}
          </Pressable>
        ))
      )}

      {result ? (
        <Text variant="caption" tone="success" accessibilityLiveRegion="polite" testID={`${testID}-result`}>
          {result}
        </Text>
      ) : null}
      {failure ? (
        <Text variant="caption" tone="error" accessibilityRole="alert" testID={`${testID}-failure`}>
          {failure}
        </Text>
      ) : null}

      {canAdd ? (
        <View style={styles.actions}>
          {Platform.OS !== 'web' ? <Button title="Take photo" variant="secondary" onPress={() => void add('camera')} loading={busy} testID="evidence-camera" /> : null}
          <Button title="Add evidence" variant="secondary" onPress={() => void add('library')} loading={busy} testID="evidence-add" />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: tapTarget, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  body: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
