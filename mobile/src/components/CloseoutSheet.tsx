import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { userMessage } from '@/api/errors'
import { useWorkflowUpload } from '@/api/quality-hooks'
import type { AttachmentRef, CloseoutInput } from '@/api/quality-types'
import { Button, Input, Text, spacing, useTheme } from '@/design-system'

type Picked = { uri: string; name: string; type: string }
const isoDay = /^\d{4}-\d{2}-\d{2}$/

/**
 * Closing out an NCR or a safety incident: what was done, who is
 * responsible, by when, and the evidence. Evidence goes through the workflow
 * upload route because that is the only evidence the server counts; the
 * closeout is then submitted for approval.
 */
export function CloseoutSheet({ visible, projectId, title, existingRefs, currentDue, busy, error, onCancel, onSubmit }: { visible: boolean; projectId: string; title: string; existingRefs: AttachmentRef[]; currentDue: string | null; busy?: boolean; error?: string | null; onCancel: () => void; onSubmit: (body: CloseoutInput) => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const upload = useWorkflowUpload(projectId)
  const [comment, setComment] = useState('')
  const [responsible, setResponsible] = useState('')
  const [due, setDue] = useState(currentDue ? currentDue.slice(0, 10) : '')
  const [photos, setPhotos] = useState<Picked[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (visible) {
      setComment('')
      setResponsible('')
      setDue(currentDue ? currentDue.slice(0, 10) : '')
      setPhotos([])
      setFailure(null)
    }
  }, [visible, currentDue])

  const evidenceCount = existingRefs.length + photos.length
  const ready = comment.trim().length > 0 && evidenceCount > 0 && isoDay.test(due)

  const pick = async (source: 'camera' | 'library') => {
    setFailure(null)
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setFailure('OctaPM needs camera or photo access to add evidence. Turn it on in Settings.')
      return
    }
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true, selectionLimit: 5 })
    if (picked.canceled) return
    setPhotos((prev) => [...prev, ...picked.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `evidence-${Date.now()}-${i}.jpg`, type: a.mimeType ?? 'image/jpeg' }))])
  }

  const submit = async () => {
    setFailure(null)
    try {
      let refs: AttachmentRef[] = existingRefs.map((r) => ({ fileName: r.fileName, fileUrl: r.fileUrl ?? r.url ?? null, storageKey: r.storageKey ?? r.key ?? null, mimeType: r.mimeType, sizeBytes: r.sizeBytes }))
      if (photos.length) {
        const files = Platform.OS === 'web' ? await Promise.all(photos.map(async (f) => new File([await (await fetch(f.uri)).blob()], f.name, { type: f.type }))) : photos
        const uploaded = await upload.mutateAsync(files)
        refs = [...refs, ...uploaded.map((u) => ({ fileName: u.fileName, fileUrl: u.fileUrl ?? u.url, storageKey: u.storageKey ?? u.key, mimeType: u.mimeType, sizeBytes: u.sizeBytes, documentId: u.documentId }))]
      }
      onSubmit({ closureComment: comment.trim(), responsible: responsible.trim() || undefined, dueDate: due, attachmentRefs: refs })
    } catch (e) {
      setFailure(userMessage(e))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="pageSheet">
      <View style={[styles.sheet, { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.md }]} testID="closeout-sheet">
        <View style={styles.header}>
          <Text variant="title" style={styles.grow}>
            {title}
          </Text>
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy || upload.isPending} />
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          <Input label="What was done" required value={comment} onChangeText={setComment} multiline placeholder="The corrective action, and how it was verified" testID="closeout-comment" />
          <Input label="Responsible" value={responsible} onChangeText={setResponsible} placeholder="Person or company responsible" testID="closeout-responsible" />
          <Input label="Due" required placeholder="YYYY-MM-DD" value={due} onChangeText={setDue} autoCapitalize="none" error={due && !isoDay.test(due) ? 'Use the form YYYY-MM-DD' : undefined} testID="closeout-due" />
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Evidence *
            </Text>
            <Text variant="caption" tone="muted">
              {existingRefs.length ? `${existingRefs.length} file${existingRefs.length === 1 ? '' : 's'} already on the record. ` : ''}
              {photos.length ? `${photos.length} new photo${photos.length === 1 ? '' : 's'} ready.` : 'At least one photo or file is required to submit.'}
            </Text>
            <View style={styles.chips}>
              {Platform.OS !== 'web' ? <Button title="Take photo" variant="secondary" onPress={() => void pick('camera')} testID="closeout-camera" /> : null}
              <Button title={Platform.OS === 'web' ? 'Add photo' : 'Choose photo'} variant="secondary" onPress={() => void pick('library')} testID="closeout-library" />
            </View>
          </View>
          {failure || error ? (
            <Text variant="caption" tone="error" accessibilityRole="alert">
              {failure ?? error}
            </Text>
          ) : null}
          <Button title="Submit closeout for approval" size="lg" fullWidth disabled={!ready} loading={busy || upload.isPending} onPress={() => void submit()} testID="closeout-submit" />
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  grow: { flex: 1 },
  body: { gap: spacing.md },
  stack: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
})
