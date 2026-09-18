import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { userMessage } from '@/api/errors'
import { useProjects } from '@/api/hooks'
import { useUploadAttachments } from '@/api/record-hooks'
import { addDailyLogEntry, getDailyLog, photoThumbnailPath } from '@/api/site-endpoints'
import { usePhotos } from '@/api/site-hooks'
import { AuthImage } from '@/components/AuthImage'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { ProjectSwitch } from '@/components/ProjectSwitch'
import { PromptSheet } from '@/components/PromptSheet'
import { Screen } from '@/components/Screen'
import { Button, EmptyState, ErrorState, Input, SkeletonList, Text, radius, spacing, useTheme } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day } from '@/utilities/format'
import { newId } from '@/utilities/id'

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Every photo on the project, newest first, with the tags and locations the
 * server extracted. A photo taken here goes onto today's daily log, with a
 * caption, through the unified attachment route with a replay key.
 */
export default function PhotosScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ add?: string }>()
  const { width } = useWindowDimensions()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const projects = useProjects()
  const permissions = usePermissions(projectId)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [captioning, setCaptioning] = useState<{ uri: string; name: string; type: string }[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const photos = usePhotos(projectId, { search: search || undefined, tag: tag ?? undefined })
  const upload = useUploadAttachments(projectId ?? '')
  const project = projects.data?.find((p) => p.id === projectId) ?? null

  const columns = width >= 900 ? 5 : width >= 600 ? 4 : 3
  const tile = Math.floor((Math.min(width, 1100) - spacing.lg * 2 - spacing.sm * (columns - 1)) / columns)
  const items = useMemo(() => photos.data?.items ?? [], [photos.data])
  const canAdd = permissions.allows('progress', 'submit')

  const pick = async (source: 'camera' | 'library') => {
    setFailure(null)
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setFailure('OctaPM needs camera or photo access to add a photo. Turn it on in Settings.')
      return
    }
    const picked = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 0.8 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true, selectionLimit: 10 })
    if (picked.canceled || picked.assets.length === 0) return
    setCaptioning(picked.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}-${index}.jpg`, type: asset.mimeType ?? 'image/jpeg' })))
  }

  useEffect(() => {
    // Only on arrival with ?add=1.
    if (params.add === '1' && canAdd) void pick(Platform.OS === 'web' ? 'library' : 'camera')
  }, [params.add, canAdd])

  const send = async (caption: string) => {
    if (!projectId || !captioning) return
    setFailure(null)
    try {
      const today = isoDay(new Date())
      let log = await getDailyLog(projectId, today)
      if (!log.exists || !log.id) log = await addDailyLogEntry(projectId, today, 'notes', { clientRequestId: newId(), kind: 'general', text: 'Site photos' })
      if (!log.id) throw new Error('The daily log could not be started.')
      const files = Platform.OS === 'web' ? await Promise.all(captioning.map(async (f) => new File([await (await fetch(f.uri)).blob()], f.name, { type: f.type }))) : captioning
      await upload.mutateAsync({ recordType: 'daily_log', recordId: log.id, role: 'photo', caption: caption || undefined, clientRequestId: newId(), files })
      setCaptioning(null)
      await photos.refetch()
    } catch (error) {
      setFailure(userMessage(error))
    }
  }

  if (!projectId) {
    return (
      <Screen testID="screen-photos">
        <ProjectSwitch project={null} />
        <EmptyState title="Choose a project first" action={{ title: 'Choose a project', onPress: () => router.push('/projects') }} />
      </Screen>
    )
  }

  return (
    <>
      <Screen scroll={false} testID="screen-photos">
        <FlatList
          key={columns}
          data={items}
          numColumns={columns}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={styles.rowWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.header}>
              <ProjectSwitch project={project} />
              {canAdd ? (
                <View style={styles.actions}>
                  {Platform.OS !== 'web' ? <Button title="Take photo" onPress={() => void pick('camera')} testID="photos-camera" /> : null}
                  <Button title={Platform.OS === 'web' ? 'Add photo' : 'Choose photo'} variant="secondary" onPress={() => void pick('library')} testID="photos-library" />
                </View>
              ) : null}
              <Input label="Find" placeholder="Caption, tag or location" value={term} onChangeText={setTerm} onSubmitEditing={() => setSearch(term.trim())} onBlur={() => setSearch(term.trim())} returnKeyType="search" autoCapitalize="none" testID="photos-search" />
              {(photos.data?.summary.tags ?? []).length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
                  {(photos.data?.summary.tags ?? []).map((t) => (
                    <FilterChip key={t} label={t} selected={tag === t} onPress={() => setTag(tag === t ? null : t)} testID={`photos-tag-${t}`} />
                  ))}
                </ScrollView>
              ) : null}
              <Freshness updatedAt={photos.dataUpdatedAt || undefined} isFetching={photos.isFetching} />
              {failure ? (
                <Text variant="caption" tone="error" accessibilityRole="alert" testID="photos-failure">
                  {failure}
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="imagebutton" accessibilityLabel={item.caption ?? 'Photo'} onPress={() => router.push(`/photos/${item.id}`)} style={[styles.tile, { width: tile, borderColor: theme.colors.border }]} testID={`photo-${item.id}`}>
              <AuthImage apiPath={photoThumbnailPath(projectId, item.id)} alt={item.caption ?? 'Photo'} style={{ width: tile, height: tile, borderRadius: radius.md }} />
              <Text variant="caption" numberOfLines={1}>
                {item.caption || (item.takenAt ? day(item.takenAt) : 'Photo')}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            photos.isPending ? (
              <SkeletonList rows={3} />
            ) : photos.isError ? (
              <ErrorState message={userMessage(photos.error)} onRetry={() => void photos.refetch()} />
            ) : (
              <EmptyState title={search || tag ? 'No photo matches' : 'No photos yet'} body={canAdd && !search && !tag ? 'Take one from the button above; it goes onto today’s daily log.' : undefined} />
            )
          }
          onRefresh={() => void photos.refetch()}
          refreshing={false}
          contentContainerStyle={styles.list}
        />
      </Screen>
      <PromptSheet visible={!!captioning} title={captioning && captioning.length > 1 ? `Caption for ${captioning.length} photos` : 'Caption'} body="Goes onto today’s daily log." label="Caption" placeholder="What the photo shows and where" confirmTitle="Upload" busy={upload.isPending} error={failure} onCancel={() => setCaptioning(null)} onConfirm={(text) => void send(text)} testID="prompt-caption" />
    </>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  rowWrap: { gap: spacing.sm },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  tile: { gap: spacing.xs },
})
