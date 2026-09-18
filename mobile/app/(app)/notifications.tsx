import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, Pressable, StyleSheet, Switch, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useNotificationActions, useNotificationPreferences, useNotificationSummary, useNotifications } from '@/api/hooks'
import type { Notification, NotificationPreference } from '@/api/types'
import { FilterChip } from '@/components/FilterChip'
import { Freshness } from '@/components/Freshness'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonList, Text, radius, spacing, tapTarget, useTheme } from '@/design-system'
import { destinationForNotification, openOnWeb } from '@/navigation/links'
import { humanise, relative } from '@/utilities/format'
import { listPerformance } from '@/components/listProps'

function NotificationRow({ item, onOpen, onArchive }: { item: Notification; onOpen: () => void; onArchive: () => void }) {
  const theme = useTheme()
  const unread = item.status === 'unread'
  const urgent = item.priority === 'high' || item.priority === 'urgent'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}`}
      accessibilityActions={[{ name: 'archive', label: 'Archive' }]}
      onAccessibilityAction={(event) => event.nativeEvent.actionName === 'archive' && onArchive()}
      onPress={onOpen}
      onLongPress={onArchive}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface, borderColor: theme.colors.border }]}
      testID={`notification-${item.id}`}
    >
      <View style={[styles.dot, { backgroundColor: unread ? theme.colors.brand : 'transparent' }]} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={unread ? styles.unread : undefined}>
          {item.title}
        </Text>
        {item.message ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {item.message}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text variant="caption" tone="muted">
            {relative(item.createdAt)} · {humanise(item.category)}
          </Text>
          {urgent ? <Badge label={humanise(item.priority)} tone="error" /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  )
}

/**
 * Everything the platform has told this person, newest first. Opening one
 * marks it read and takes the person to the record; a long press archives.
 */
export default function NotificationsScreen() {
  const router = useRouter()
  const [status, setStatus] = useState<'unread' | 'active'>('unread')
  const [showPreferences, setShowPreferences] = useState(false)
  const list = useNotifications(status)
  const summary = useNotificationSummary()
  const preferences = useNotificationPreferences()
  const actions = useNotificationActions()

  const open = async (item: Notification) => {
    if (item.status === 'unread') actions.markRead.mutate({ id: item.id })
    const destination = destinationForNotification(item)
    if (!destination) return
    if ('app' in destination) router.push(destination.app as never)
    else await openOnWeb(destination.web)
  }

  const toggle = (pref: NotificationPreference, field: 'inAppEnabled' | 'pushEnabled', value: boolean) =>
    actions.savePreferences.mutate([{ category: pref.category, [field]: value }])

  const rows = list.data?.rows ?? []

  return (
    <Screen
      title="Notifications"
      subtitle={summary.data ? `${summary.data.unread} unread` : undefined}
      scroll={false}
      actions={
        <Button title="Mark all read" variant="ghost" disabled={!summary.data || summary.data.unread === 0} loading={actions.markAllRead.isPending} onPress={() => actions.markAllRead.mutate()} testID="mark-all-read" />
      }
      testID="screen-notifications"
    >
      <FlatList {...listPerformance}
        data={rows}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.chips}>
              <FilterChip label="Unread" count={summary.data?.unread} selected={status === 'unread'} onPress={() => setStatus('unread')} testID="chip-unread" />
              <FilterChip label="All" selected={status === 'active'} onPress={() => setStatus('active')} testID="chip-all" />
            </View>
            <Freshness updatedAt={list.dataUpdatedAt || undefined} isFetching={list.isFetching} />
          </View>
        }
        renderItem={({ item }) => <NotificationRow item={item} onOpen={() => void open(item)} onArchive={() => actions.archive.mutate(item.id)} />}
        ListEmptyComponent={
          list.isPending ? (
            <SkeletonList rows={5} />
          ) : list.isError ? (
            <ErrorState message={userMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : (
            <EmptyState title={status === 'unread' ? 'You are up to date' : 'No notifications yet'} body={status === 'unread' ? 'New notifications appear here as records change.' : undefined} />
          )
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {list.data?.pagination.nextCursor ? (
              <Text variant="caption" tone="muted">
                Showing the latest {rows.length}. Older notifications are on the web platform.
              </Text>
            ) : null}
            <Button title={showPreferences ? 'Hide preferences' : 'Notification preferences'} variant="secondary" onPress={() => setShowPreferences((v) => !v)} testID="toggle-preferences" />
            {showPreferences ? (
              <Card>
                <View style={styles.prefs}>
                  <Text variant="label" label tone="muted">
                    By category
                  </Text>
                  <View style={styles.prefHeader}>
                    <Text variant="caption" tone="muted" style={styles.prefName}>
                      Category
                    </Text>
                    <Text variant="caption" tone="muted" style={styles.prefCol}>
                      In app
                    </Text>
                    <Text variant="caption" tone="muted" style={styles.prefCol}>
                      Push
                    </Text>
                  </View>
                  {preferences.isPending ? (
                    <SkeletonList rows={3} />
                  ) : preferences.isError ? (
                    <ErrorState message={userMessage(preferences.error)} onRetry={() => void preferences.refetch()} />
                  ) : (
                    preferences.data.map((pref) => (
                      <View key={pref.category} style={styles.prefRow}>
                        <Text style={styles.prefName}>{humanise(pref.category)}</Text>
                        <View style={styles.prefCol}>
                          <Switch value={pref.inAppEnabled} onValueChange={(v) => toggle(pref, 'inAppEnabled', v)} accessibilityLabel={`${humanise(pref.category)} in app`} testID={`pref-${pref.category}-inapp`} />
                        </View>
                        <View style={styles.prefCol}>
                          <Switch value={pref.pushEnabled} onValueChange={(v) => toggle(pref, 'pushEnabled', v)} accessibilityLabel={`${humanise(pref.category)} push`} testID={`pref-${pref.category}-push`} />
                        </View>
                      </View>
                    ))
                  )}
                  <Text variant="caption" tone="muted">
                    Push delivery to this device is not available yet; the preference is kept for when it is.
                  </Text>
                </View>
              </Card>
            ) : null}
            <Button title="Back to Home" variant="ghost" onPress={() => router.replace('/')} />
          </View>
        }
        onRefresh={() => void Promise.all([list.refetch(), summary.refetch()])}
        refreshing={false}
        contentContainerStyle={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', gap: spacing.sm },
  list: { gap: spacing.xs, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: tapTarget, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  unread: { fontFamily: 'Inter_600SemiBold' },
  footer: { gap: spacing.md, paddingTop: spacing.lg },
  prefs: { gap: spacing.sm },
  prefHeader: { flexDirection: 'row', alignItems: 'center' },
  prefRow: { flexDirection: 'row', alignItems: 'center', minHeight: tapTarget },
  prefName: { flex: 1 },
  prefCol: { width: 72, alignItems: 'center' },
})
