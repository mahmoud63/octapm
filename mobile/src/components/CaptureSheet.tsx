import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Text, spacing, tapTarget, useTheme } from '@/design-system'
import type { CaptureAction } from '@/navigation/roleNav'

/**
 * The centre button: everything this person can record right now, in the
 * order their job reaches for it.
 *
 * The list is resolved from the role for its order and from the permission
 * matrix for its contents, so nothing here is offered that the server would
 * refuse. An empty list means the person may record nothing on this project,
 * and the sheet says so rather than showing an empty box.
 */
export function CaptureSheet({ visible, actions, onClose }: { visible: boolean; actions: CaptureAction[]; onClose: () => void }) {
  const theme = useTheme()
  const router = useRouter()

  const go = (action: CaptureAction) => {
    onClose()
    router.push(action.route as never)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]} onPress={onClose} accessibilityLabel="Close" testID="capture-backdrop">
        <Pressable style={[styles.sheet, { backgroundColor: theme.colors.background }]} onPress={(e) => e.stopPropagation()} testID="capture-sheet">
          <View style={styles.grabber}>
            <View style={[styles.grabberBar, { backgroundColor: theme.colors.border }]} />
          </View>
          <Text variant="title">Capture</Text>
          {actions.length === 0 ? (
            <Text tone="muted">You have no recording rights on this project yet. Ask your project manager to add them.</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {actions.map((action) => (
                <Pressable
                  key={action.id}
                  onPress={() => go(action)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, { borderColor: theme.colors.border, backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface }]}
                  testID={`capture-${action.id}`}
                >
                  <View style={[styles.icon, { backgroundColor: theme.colors.infoSoft }]}>
                    <Ionicons name={action.icon as never} size={20} color={theme.colors.brandStrong} />
                  </View>
                  <Text style={styles.grow}>{action.title}</Text>
                  <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, gap: spacing.md, maxHeight: '80%' },
  grabber: { alignItems: 'center', paddingBottom: spacing.xs },
  grabberBar: { width: 40, height: 4, borderRadius: 2 },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: tapTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderRadius: 12 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
})
