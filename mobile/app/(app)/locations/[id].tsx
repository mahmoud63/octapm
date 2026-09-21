import { useLocalSearchParams, useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { useForms, usePunchList } from '@/api/quality-hooks'
import { useLocations, useRfis, useSheets } from '@/api/record-hooks'
import { usePhotos } from '@/api/site-hooks'
import { Freshness } from '@/components/Freshness'
import { RelatedRecords, type RelatedGroup } from '@/components/RelatedRecords'
import { Screen } from '@/components/Screen'
import { Button, Card, ErrorState, SkeletonList, Text, spacing } from '@/design-system'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

/**
 * One place on the project, and everything raised about it.
 *
 * Construction is argued about by location long before it is argued about by
 * record type: what is outstanding in this room, what was photographed on this
 * level. The five registers below are the ones the platform can genuinely
 * answer that question for — each carries a location of its own and each can be
 * asked for one. Activities, tasks and materials are missing on purpose: no
 * activity in this schema belongs to a place, and inventing that link here
 * would be a worse answer than not offering it.
 */
export default function LocationDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const locations = useLocations(projectId)
  const location = locations.data?.find((l) => l.id === id) ?? null

  const filters = { locationId: id }
  const rfis = useRfis(projectId, filters)
  const punch = usePunchList(projectId, filters)
  const forms = useForms(projectId, filters)
  const photos = usePhotos(projectId, filters)
  const sheets = useSheets(projectId, filters)

  if (locations.isPending) {
    return (
      <Screen title="Location" testID="screen-location">
        <SkeletonList rows={4} />
      </Screen>
    )
  }
  if (!location) {
    return (
      <Screen title="Location" testID="screen-location">
        <ErrorState message="That location is not on this project." onRetry={() => router.replace('/locations')} />
      </Screen>
    )
  }

  const open = (route: string) => router.push(route as never)

  const groups: RelatedGroup[] = [
    {
      id: 'rfis',
      isPending: rfis.isPending,
      // The RFI register matches this location exactly, where punch, inspections,
      // drawings and photographs all include everything beneath it. Say which
      // question is being answered rather than implying the wrong one.
      title: 'RFIs at this location',
      emptyText: 'Nothing has been asked about this place.',
      records: (rfis.data?.rows ?? []).map((r) => ({ id: r.id, reference: r.ref, title: r.subject, status: r.status, onPress: () => open(`/rfi/${r.id}`) })),
      action: { title: 'All RFIs', onPress: () => open('/rfi') },
    },
    {
      id: 'punch',
      title: 'Punch',
      isPending: punch.isPending,
      emptyText: 'Nothing outstanding here.',
      records: (punch.data?.items ?? []).map((p) => ({ id: p.id, reference: p.ref, title: p.title, status: p.status, onPress: () => open(`/quality/punch/${p.id}`) })),
      action: { title: 'All punch', onPress: () => open('/quality/punch') },
    },
    {
      id: 'inspections',
      title: 'Inspections',
      isPending: forms.isPending,
      emptyText: 'None have been done here.',
      records: (forms.data?.items ?? []).map((f) => ({ id: f.id, reference: f.ref, title: f.title, status: f.status, onPress: () => open(`/quality/inspections/${f.id}`) })),
      action: { title: 'All inspections', onPress: () => open('/quality/inspections') },
    },
    {
      id: 'drawings',
      title: 'Drawings',
      isPending: sheets.isPending,
      emptyText: 'No drawing is filed against this place.',
      records: (sheets.data?.items ?? []).map((s) => ({ id: s.id, reference: s.number ?? 'Sheet', title: s.title ?? 'Drawing', onPress: () => open(`/drawings/${s.id}`) })),
      action: { title: 'All drawings', onPress: () => open('/drawings') },
    },
    {
      id: 'photos',
      title: 'Photographs',
      isPending: photos.isPending,
      emptyText: 'Nothing has been photographed here.',
      records: (photos.data?.items ?? []).slice(0, 6).map((p) => ({ id: p.id, reference: p.takenAt ? day(p.takenAt) : 'Photo', title: p.caption || 'Photograph', onPress: () => open(`/photos/${p.id}`) })),
      action: { title: 'All photos', onPress: () => open('/photos') },
    },
  ]

  return (
    <Screen title={location.name} subtitle={location.fullName} contentStyle={styles.content} testID="screen-location">
      <Card testID="location-head">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            {[location.code, location.kind ? humanise(location.kind) : null].filter(Boolean).join(' · ') || 'Location'}
          </Text>
          <Text testID="location-path">{location.fullName}</Text>
          {location.childCount ? (
            <Button title={`${location.childCount} inside`} variant="secondary" onPress={() => open('/locations')} testID="location-children" />
          ) : null}
        </View>
      </Card>

      {/* What a person standing here would want to start. */}
      <Card testID="location-actions">
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Record something here
          </Text>
          <View style={styles.actions}>
            {permissions.allows('photos', 'create') ? <Button title="Take a photograph" variant="secondary" onPress={() => open(`/capture?locationId=${location.id}`)} testID="location-capture" /> : null}
            {permissions.allows('rfi', 'create') ? <Button title="Raise an RFI" variant="secondary" onPress={() => open(`/rfi/new?locationId=${location.id}`)} testID="location-rfi" /> : null}
            {permissions.allows('punch', 'create') ? <Button title="Add a punch item" variant="secondary" onPress={() => open(`/quality/punch/new?locationId=${location.id}`)} testID="location-punch" /> : null}
            {permissions.allows('inspection', 'create') ? <Button title="Start an inspection" variant="secondary" onPress={() => open(`/quality/inspections/new?locationId=${location.id}`)} testID="location-inspection" /> : null}
          </View>
        </View>
      </Card>

      {rfis.isError ? <ErrorState message={userMessage(rfis.error)} onRetry={() => void rfis.refetch()} /> : null}
      <RelatedRecords groups={groups} testID="location-related" />
      <Freshness updatedAt={rfis.dataUpdatedAt || undefined} isFetching={rfis.isFetching || punch.isFetching} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  actions: { gap: spacing.sm },
})
