import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import type { CaptureAction } from '@/navigation/roleNav'
import type { Photo } from '@/api/site-types'
import { Button, Text, spacing, tapTarget, useTheme } from '@/design-system'
import { AuthImage } from '@/components/AuthImage'
import { photoThumbnailPath } from '@/api/site-endpoints'

/**
 * The pieces every role home is built from.
 *
 * A home is a sequence of sections, not a wall of cards: a heading, the
 * content, and — where it helps — one way through to the module. Sharing
 * these keeps nine homes consistent without making them identical.
 */

export function Section({ title, action, children, testID }: { title: string; action?: { title: string; onPress: () => void; testID?: string }; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <Text variant="label" label tone="muted" style={styles.grow}>
          {title}
        </Text>
        {action ? (
          <Pressable accessibilityRole="link" onPress={action.onPress} hitSlop={8} testID={action.testID}>
            <Text tone="link">{action.title}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

/**
 * The headline count row: a few numbers that say what kind of day it is.
 * Each is tappable through to the thing it counts, because a number a person
 * cannot open is a number they cannot act on.
 */
export function Counts({ items }: { items: { id: string; label: string; value: string; tone?: 'default' | 'warning' | 'error' | 'success'; onPress?: () => void }[] }) {
  const theme = useTheme()
  const colour = (tone?: string) => (tone === 'error' ? theme.colors.error : tone === 'warning' ? theme.colors.warning : tone === 'success' ? theme.colors.success : theme.colors.text)
  return (
    <View style={styles.counts}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={item.onPress}
          disabled={!item.onPress}
          accessibilityRole={item.onPress ? 'button' : undefined}
          style={({ pressed }) => [styles.count, { borderColor: theme.colors.border, backgroundColor: pressed && item.onPress ? theme.colors.surfaceRaised : theme.colors.surface }]}
          testID={`count-${item.id}`}
        >
          <Text variant="heading" style={{ color: colour(item.tone) }}>
            {item.value}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * A strip of recent site photographs, newest first.
 *
 * A thumbnail is requested only once the server says it is ready. The
 * platform generates them in the background and reports `thumbnailStatus`;
 * asking for one that is still pending returns a 500, so a strip of twelve
 * would fire twelve failing requests on every render and show twelve empty
 * tiles. Until the thumbnail exists the photograph is still listed and still
 * opens — it just does not pretend to have a preview.
 */
export function PhotoStrip({ projectId, photos, onOpen, testID }: { projectId: string; photos: Photo[]; onOpen: (photo: Photo) => void; testID?: string }) {
  const theme = useTheme()
  if (photos.length === 0) return <Text tone="muted">No photographs yet.</Text>
  const ready = photos.filter((p) => p.thumbnailStatus === 'ready')
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} testID={testID}>
        {photos.map((photo) => (
          <Pressable key={photo.id} onPress={() => onOpen(photo)} accessibilityRole="button" testID={`photo-${photo.id}`}>
            {photo.thumbnailStatus === 'ready' ? (
              <AuthImage apiPath={photoThumbnailPath(projectId, photo.id)} alt={photo.caption ?? 'Site photograph'} style={[styles.thumb, { backgroundColor: theme.colors.skeleton, borderColor: theme.colors.border }]} />
            ) : (
              <View style={[styles.thumb, styles.pending, { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border }]}>
                <Ionicons name="image-outline" size={22} color={theme.colors.textMuted} />
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
      {ready.length === 0 ? (
        <Text variant="caption" tone="muted">
          {photos.length} photograph{photos.length === 1 ? '' : 's'}; previews are still being generated.
        </Text>
      ) : null}
    </>
  )
}

/** The role's quick actions, as compact chips under the content they serve. */
export function QuickActions({ actions, testID }: { actions: CaptureAction[]; testID?: string }) {
  const router = useRouter()
  const theme = useTheme()
  if (actions.length === 0) return null
  return (
    <View style={styles.actions} testID={testID}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={() => router.push(action.route as never)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.chip, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
          testID={`quick-${action.id}`}
        >
          <Ionicons name={action.icon as never} size={16} color={theme.colors.brandStrong} />
          <Text variant="caption">{action.title}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/** One line that names where a figure came from, so nothing looks invented. */
export function Provenance({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="caption" tone="muted">
      {children}
    </Text>
  )
}

export { Button }

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  count: { flexGrow: 1, flexBasis: '28%', minHeight: tapTarget + 8, gap: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: 12 },
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  thumb: { width: 96, height: 96, borderRadius: 10, borderWidth: 1 },
  pending: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: tapTarget, paddingHorizontal: spacing.md, borderWidth: 1, borderRadius: 999 },
})
