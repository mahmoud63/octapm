import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { documentFilePath } from '@/api/record-endpoints'
import { useOfflineManifest, useSheet, useSheetPins } from '@/api/record-hooks'
import { PdfPage } from '@/components/PdfPage'
import { RecordHeader } from '@/components/RecordHeader'
import { Screen } from '@/components/Screen'
import { Badge, Button, Card, ErrorState, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { keepSheetFile, keptState, removeSheetFile } from '@/drawings/offline'
import { useDrawingPrefs } from '@/drawings/preferences'
import { appRouteForRecord, openOnWeb, webPathForTarget } from '@/navigation/links'
import { usePermissions } from '@/permissions/usePermissions'
import { useProjectStore } from '@/projects/store'
import { day, humanise } from '@/utilities/format'

/**
 * One sheet: the current published page, fitted to width, with the sheet's
 * pins and the ways to act from it. A superseded or obsolete sheet says so
 * before the page, every time, and offers the latest revision.
 */
export default function SheetScreen() {
  const theme = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const permissions = usePermissions(projectId)
  const sheet = useSheet(projectId, id ?? null)
  const pins = useSheetPins(projectId, id ?? null)
  const prefs = useDrawingPrefs()
  const manifest = useOfflineManifest(projectId)
  const [keeping, setKeeping] = useState(false)
  const [keepFailure, setKeepFailure] = useState<string | null>(null)

  useEffect(() => {
    if (id && sheet.data) void prefs.noteViewed(id)
    // Note the view once per loaded sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sheet.data?.id])

  if (!projectId || !id) {
    return (
      <Screen testID="screen-sheet">
        <ErrorState message="Choose a project to open this sheet." onRetry={() => router.replace('/projects')} />
      </Screen>
    )
  }
  if (sheet.isPending) {
    return (
      <Screen testID="screen-sheet">
        <SkeletonList rows={5} />
      </Screen>
    )
  }
  if (sheet.isError) {
    return (
      <Screen testID="screen-sheet">
        <ErrorState message={userMessage(sheet.error)} onRetry={() => void sheet.refetch()} />
      </Screen>
    )
  }

  const record = sheet.data
  const revision = record.currentRevision
  const superseded = record.status === 'obsolete' || (revision ? revision.status === 'superseded' : false)
  const favourite = prefs.favourites.includes(record.id)
  const pinList = pins.data ?? []
  const offline = keptState(record.id, prefs.kept, manifest.data)
  // The copy on this device is older than what the server now holds.
  const staleCopy = offline.superseded

  const keep = async () => {
    if (!revision?.documentId) return
    setKeepFailure(null)
    setKeeping(true)
    try {
      const fileUri = await keepSheetFile(documentFilePath(projectId, revision.documentId), record.id)
      await prefs.keepOffline(record.id, { revisionId: revision.id, revision: revision.revision, fileUri })
    } catch (error) {
      setKeepFailure(userMessage(error))
    } finally {
      setKeeping(false)
    }
  }
  const release = async () => {
    await removeSheetFile(offline.kept?.fileUri ?? null)
    await prefs.releaseOffline(record.id)
  }

  return (
    <Screen contentStyle={styles.content} testID="screen-sheet">
      <RecordHeader reference={record.number} title={record.title ?? record.number} status={superseded || staleCopy ? 'superseded' : (revision?.status ?? null)} meta={[humanise(record.discipline), revision ? `Revision ${revision.revision}` : 'No published revision', revision?.publishedAt ? `Published ${day(revision.publishedAt)}` : null, offline.kept ? `Kept offline at Rev ${offline.kept.revision}` : null].filter((v): v is string => !!v)} testID="sheet-header" />

      {superseded || staleCopy ? (
        <Card edge={theme.colors.error} testID="sheet-superseded">
          <View style={styles.stack}>
            <Text variant="heading" tone="error">
              SUPERSEDED DRAWING
            </Text>
            <Text>{staleCopy ? `The copy kept on this device is Rev ${offline.kept!.revision}; the server now holds Rev ${offline.latest!.revision}. Do not build from the kept copy.` : 'A newer revision is available. Do not build from this sheet.'}</Text>
            {staleCopy ? <Button title="Keep the latest revision" loading={keeping} onPress={() => void keep()} testID="sheet-keep-latest" /> : <Button title="Open the latest revision" onPress={() => router.replace(`/drawings/${record.id}`)} testID="sheet-open-latest" />}
          </View>
        </Card>
      ) : null}

      {revision?.documentId ? (
        <PdfPage apiPath={documentFilePath(projectId, revision.documentId)} page={revision.pageNumber} fileName={`${record.number}-rev${revision.revision}.pdf`} localUri={offline.kept?.fileUri ?? undefined} testID="sheet-page" />
      ) : (
        <Card>
          <Text tone="muted">This sheet has no published file yet.</Text>
        </Card>
      )}

      <View style={styles.actions}>
        <Button title={favourite ? '★ Favourite' : '☆ Add to favourites'} variant="secondary" onPress={() => void prefs.toggleFavourite(record.id)} testID="sheet-favourite" />
        {revision?.documentId ? (
          offline.kept && !staleCopy ? (
            <Button title="Remove from this device" variant="ghost" onPress={() => void release()} testID="sheet-release" />
          ) : (
            <Button title={staleCopy ? 'Replace the kept copy' : 'Keep offline'} variant="secondary" loading={keeping} onPress={() => void keep()} testID="sheet-keep" />
          )
        ) : null}
        {keepFailure ? (
          <Text tone="error" accessibilityRole="alert">
            {keepFailure}
          </Text>
        ) : null}
        {permissions.allows('rfi', 'create') ? <Button title="Raise RFI from here" variant="secondary" onPress={() => router.push({ pathname: '/rfi/new', params: { locationId: record.locationId ?? '' } } as never)} testID="sheet-raise-rfi" /> : null}
        <Button title="Open on the web" variant="ghost" onPress={() => void openOnWeb(webPathForTarget({ projectId, module: 'doc-control', child: 'drawings', recordType: 'sheet', recordId: record.id }))} />
      </View>

      <Card>
        <View style={styles.stack}>
          <Text variant="label" label tone="muted">
            Pins on this sheet
          </Text>
          {pins.isPending ? (
            <SkeletonList rows={1} />
          ) : pinList.length === 0 ? (
            <Text tone="muted">No pins yet. Pins that create punch items and link inspections arrive with the quality milestone.</Text>
          ) : (
            pinList.map((pin) => {
              const route = appRouteForRecord(pin.recordType, pin.recordId)
              return (
                <View key={pin.id} style={styles.pin} testID={`pin-${pin.id}`}>
                  <Badge label={pin.label ?? humanise(pin.recordType)} tone="info" />
                  <Text variant="caption" tone="muted" style={styles.grow}>
                    {humanise(pin.recordType)} at {Math.round(pin.x * 100)}%, {Math.round(pin.y * 100)}%
                  </Text>
                  <Button title="Open" variant="ghost" onPress={() => (route ? router.push(route as never) : void openOnWeb(webPathForTarget({ projectId, module: 'quality', recordType: pin.recordType, recordId: pin.recordId })))} />
                </View>
              )
            })
          )}
        </View>
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pin: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
