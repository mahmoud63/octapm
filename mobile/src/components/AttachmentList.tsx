import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { documentFilePath } from '@/api/record-endpoints'
import { useAttachments, useUploadAttachments } from '@/api/record-hooks'
import type { AttachmentItem } from '@/api/record-types'
import { Button, ErrorState, SkeletonList, Text, radius, spacing, tapTarget, useTheme } from '@/design-system'
import { openApiFile } from '@/files/open'
import { newId } from '@/utilities/id'
import { relative } from '@/utilities/format'

const size = (bytes: number | null) => (bytes == null ? '' : bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)

/**
 * The files on a record, and a way to add a photo from the camera or the
 * library. Uploads carry a replay key so a retry after a dropped connection
 * cannot attach the same photo twice.
 */
export function AttachmentList({ projectId, recordType, recordId, canAdd }: { projectId: string; recordType: string; recordId: string; canAdd: boolean }) {
  const theme = useTheme()
  const attachments = useAttachments(projectId, recordType, recordId)
  const upload = useUploadAttachments(projectId)
  const [opening, setOpening] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

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
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setFailure(source === 'camera' ? 'Camera access is off for OctaPM. Turn it on in Settings to take a photo.' : 'Photo access is off for OctaPM. Turn it on in Settings to choose a photo.')
      return
    }
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true, selectionLimit: 10 })
    if (picked.canceled || picked.assets.length === 0) return
    const files = picked.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}-${index}.jpg`, type: asset.mimeType ?? 'image/jpeg' }))
    try {
      await upload.mutateAsync({ recordType, recordId, role: 'photo', clientRequestId: newId(), files: Platform.OS === 'web' ? await Promise.all(files.map(async (f) => new File([await (await fetch(f.uri)).blob()], f.name, { type: f.type }))) : files })
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <View style={styles.wrap} testID="attachments">
      <Text variant="label" label tone="muted">
        Attachments
      </Text>
      {attachments.isPending ? (
        <SkeletonList rows={1} />
      ) : attachments.isError ? (
        <ErrorState message={userMessage(attachments.error)} onRetry={() => void attachments.refetch()} />
      ) : attachments.data.length === 0 ? (
        <Text tone="muted">No files yet.</Text>
      ) : (
        attachments.data.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.fileName ?? 'attachment'}`}
            onPress={() => void open(item)}
            style={({ pressed }) => [styles.row, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
            testID={`attachment-${item.id}`}
          >
            <Ionicons name={item.photo ? 'image-outline' : 'document-outline'} size={22} color={theme.colors.brand} />
            <View style={styles.body}>
              <Text numberOfLines={1}>{item.caption || item.fileName || 'Attachment'}</Text>
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
      {failure ? (
        <Text variant="caption" tone="error" accessibilityRole="alert">
          {failure}
        </Text>
      ) : null}
      {canAdd ? (
        <View style={styles.actions}>
          {Platform.OS !== 'web' ? <Button title="Take photo" variant="secondary" onPress={() => void add('camera')} loading={upload.isPending} testID="attachment-camera" /> : null}
          <Button title={Platform.OS === 'web' ? 'Add photo' : 'Choose photo'} variant="secondary" onPress={() => void add('library')} loading={upload.isPending} testID="attachment-library" />
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
