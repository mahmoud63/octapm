import { StyleSheet, View } from 'react-native'
import { Badge, Button, Card, RecordRow, SkeletonList, Text, spacing } from '@/design-system'

export interface RelatedRecord {
  id: string
  reference: string
  title: string
  status?: string | null
  meta?: string
  onPress: () => void
}

export interface RelatedGroup {
  id: string
  title: string
  isPending?: boolean
  records: RelatedRecord[]
  /** Said plainly when there is nothing, rather than an empty heading. */
  emptyText?: string
  /** Where the whole set lives, when there is more than this shows. */
  action?: { title: string; onPress: () => void }
  /** How many to show before the action carries the rest. */
  limit?: number
}

/**
 * What else belongs to this thing.
 *
 * A person standing in a room, or looking at one activity, asks the same
 * question about it: what has already been raised here, and can I open it. So
 * every group is real records with their own references — RFI-034, not "3
 * RFIs" — because a reference is what gets said on site and typed into a
 * search, and tapping one opens the record itself rather than a filtered list
 * to hunt through.
 *
 * Groups with nothing in them still appear, quietly. An empty Inspections
 * heading is information: it says none have been done here, which is often
 * the point of looking.
 */
export function RelatedRecords({ groups, testID = 'related' }: { groups: RelatedGroup[]; testID?: string }) {
  return (
    <>
      {groups.map((group) => {
        const limit = group.limit ?? 4
        const shown = group.records.slice(0, limit)
        const rest = group.records.length - shown.length
        return (
          <Card key={group.id} testID={`${testID}-${group.id}`}>
            <View style={styles.stack}>
              <View style={styles.row}>
                <Text variant="label" label tone="muted">
                  {group.title}
                </Text>
                <Badge label={String(group.records.length)} tone={group.records.length ? 'info' : 'neutral'} />
                <View style={styles.grow} />
                {group.action ? <Button title={group.action.title} variant="ghost" onPress={group.action.onPress} testID={`${testID}-${group.id}-all`} /> : null}
              </View>

              {group.isPending ? (
                <SkeletonList rows={2} />
              ) : group.records.length === 0 ? (
                <Text tone="muted">{group.emptyText ?? 'Nothing here yet.'}</Text>
              ) : (
                <>
                  {shown.map((record) => (
                    <RecordRow
                      key={record.id}
                      reference={record.reference}
                      title={record.title}
                      status={record.status ?? undefined}
                      meta={record.meta}
                      onPress={record.onPress}
                      testID={`${testID}-${group.id}-${record.id}`}
                    />
                  ))}
                  {rest > 0 ? (
                    <Text variant="caption" tone="muted">
                      and {rest} more
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          </Card>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
})
