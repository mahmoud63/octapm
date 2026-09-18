import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { userMessage } from '@/api/errors'
import { photoFilePath } from '@/api/site-endpoints'
import { usePhotos, useUpdatePhoto } from '@/api/site-hooks'
import { AuthImage } from '@/components/AuthImage'
import { PromptSheet } from '@/components/PromptSheet'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, radius, spacing } from '@/design-system'
import { appRouteForRecord, openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { dateTime, humanise } from '@/utilities/format'

/**
 * One photo at full size, with what the server knows about it and the
 * records it belongs to. Caption and tags can be corrected; position and
 * time are the camera's and stay as they were taken.
 */
export default function PhotoScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const photos = usePhotos(projectId)
  const update = useUpdatePhoto(projectId ?? '')
  const [editing, setEditing] = useState<'caption' | 'tags' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const photo = useMemo(() => photos.data?.items.find((p) => p.id === id) ?? null, [photos.data, id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-photo">
        <ErrorState message="Choose a project to open this photo." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (photos.isPending) {
    return (
      <Screen testID="screen-photo">
        <SkeletonList rows={4} />
      </Screen>
    )
  }
  if (photos.isError || !photo) {
    return (
      <Screen testID="screen-photo">
        <ErrorState message={photos.isError ? userMessage(photos.error) : 'This photo is no longer available.'} onRetry={() => void photos.refetch()} />
      </Screen>
    )
  }

  const canEdit = permissions.allows('document_control', 'create')
  const size = Math.min(width - spacing.lg * 2, 1000)
  const height = photo.width && photo.height ? Math.round((size * photo.height) / photo.width) : size

  const save = async (field: 'caption' | 'tags', text: string) => {
    setFailure(null)
    try {
      await update.mutateAsync({ photoId: photo.id, body: field === 'caption' ? { caption: text } : { tags: text.split(',').map((t) => t.trim()).filter(Boolean) } })
      setEditing(null)
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  return (
    <>
      <Screen contentStyle={styles.content} testID="screen-photo">
        <AuthImage apiPath={photoFilePath(projectId, photo.id)} alt={photo.caption ?? 'Photo'} style={{ width: size, height, borderRadius: radius.md, alignSelf: 'center' }} testID="photo-image" />
        <Card>
          <View style={styles.stack}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.grow} testID="photo-caption">
                {photo.caption || 'No caption'}
              </Text>
              {canEdit ? <Button title="Edit" variant="ghost" onPress={() => setEditing('caption')} testID="photo-edit-caption" /> : null}
            </View>
            <View style={styles.row}>
              <View style={[styles.grow, styles.chips]}>{photo.tags.length ? photo.tags.map((t) => <Badge key={t} label={t} tone="info" />) : <Text tone="muted">No tags</Text>}</View>
              {canEdit ? <Button title="Tags" variant="ghost" onPress={() => setEditing('tags')} testID="photo-edit-tags" /> : null}
            </View>
            <Text variant="caption" tone="muted">
              {[photo.takenAt ? `Taken ${dateTime(photo.takenAt)}` : null, photo.location?.name, [photo.cameraMake, photo.cameraModel].filter(Boolean).join(' '), photo.width && photo.height ? `${photo.width} × ${photo.height}` : null].filter(Boolean).join(' · ') || 'No camera details'}
            </Text>
            {photo.latitude != null && photo.longitude != null ? (
              <Text variant="caption" tone="muted">
                Position recorded by the camera. Shown only to people who can see this project.
              </Text>
            ) : null}
          </View>
        </Card>
        <Card>
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              On these records
            </Text>
            {photo.records.length === 0 ? (
              <Text tone="muted">Not linked to a record.</Text>
            ) : (
              photo.records.map((r) => {
                const route = appRouteForRecord(r.recordType, r.recordId)
                return (
                  <View key={`${r.recordType}:${r.recordId}`} style={styles.row}>
                    <Text style={styles.grow}>
                      {r.ref ? `${r.ref} · ` : ''}
                      {r.title ?? humanise(r.recordType)}
                    </Text>
                    <Button title="Open" variant="ghost" onPress={() => (route ? router.push(route as never) : void openOnWeb(webPathForTarget({ projectId, module: 'photos', recordType: r.recordType, recordId: r.recordId })))} />
                  </View>
                )
              })
            )}
          </View>
        </Card>
        {failure ? (
          <Text tone="error" accessibilityRole="alert">
            {failure}
          </Text>
        ) : null}
      </Screen>
      <PromptSheet visible={editing === 'caption'} title="Caption" label="Caption" confirmTitle="Save" busy={update.isPending} error={failure} onCancel={() => setEditing(null)} onConfirm={(text) => void save('caption', text)} testID="prompt-photo-caption" />
      <PromptSheet visible={editing === 'tags'} title="Tags" body="Separate tags with commas." label="Tags" placeholder="concrete, grid A-D, defect" confirmTitle="Save" busy={update.isPending} error={failure} onCancel={() => setEditing(null)} onConfirm={(text) => void save('tags', text)} testID="prompt-photo-tags" />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
})
