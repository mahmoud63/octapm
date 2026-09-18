import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { isAppError, userMessage } from '@/api/errors'
import { useScan } from '@/api/inventory-hooks'
import { Screen } from '@/components/Screen'
import { Button, Card, ErrorState, Input, KPI, SkeletonList, Text, spacing, useTheme } from '@/design-system'
import { quantity } from '@/utilities/format'

// The camera module is loaded only on a device: the web target has no scanner, and the test runner fakes it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const camera = Platform.OS === 'web' ? null : (require('expo-camera') as typeof import('expo-camera'))

const BARCODE_TYPES = ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'datamatrix', 'pdf417', 'itf14'] as const

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const theme = useTheme()
  const [permission, request] = camera!.useCameraPermissions()
  const [busy, setBusy] = useState(false)
  if (!permission) return null
  if (!permission.granted) {
    return (
      <Card>
        <View style={styles.stack}>
          <Text>OctaPM needs the camera to read barcodes and QR codes.</Text>
          <Button title={permission.canAskAgain ? 'Allow the camera' : 'Open Settings to allow the camera'} onPress={() => void request()} testID="scan-allow" />
        </View>
      </Card>
    )
  }
  const CameraView = camera!.CameraView
  return (
    <View style={[styles.viewfinder, { borderColor: theme.colors.border }]} testID="scan-camera">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={
          busy
            ? undefined
            : ({ data }) => {
                if (!data) return
                setBusy(true)
                onCode(data)
              }
        }
      />
    </View>
  )
}

/**
 * Point the camera at a barcode or QR code, or type a SKU, and the item
 * comes up with its stock by warehouse. The server resolves items only:
 * bins, warehouses and purchase orders have no codes of their own.
 */
export default function ScanScreen() {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const scan = useScan(code)
  const notFound = scan.isError && isAppError(scan.error) && scan.error.status === 404

  return (
    <Screen contentStyle={styles.content} testID="screen-scan">
      {!code && camera ? <Scanner onCode={(c) => setCode(c.trim())} /> : null}
      {!code ? (
        <Card>
          <View style={styles.stack}>
            <Input label="Barcode, QR code or SKU" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="e.g. CEM-42.5N" returnKeyType="search" onSubmitEditing={() => typed.trim() && setCode(typed.trim())} testID="scan-code" />
            <Button title="Look up" disabled={!typed.trim()} onPress={() => setCode(typed.trim())} testID="scan-lookup" />
            {!camera ? (
              <Text variant="caption" tone="muted">
                The camera reads codes on a phone or tablet. On the web, type the code.
              </Text>
            ) : null}
          </View>
        </Card>
      ) : scan.isPending ? (
        <SkeletonList rows={3} />
      ) : notFound ? (
        <Card>
          <View style={styles.stack}>
            <Text variant="heading" testID="scan-miss">
              No item matches {code}
            </Text>
            <Text tone="muted">Only items carry codes here. Check the label, or find the item by name.</Text>
            <Button title="Try again" onPress={() => setCode(null)} testID="scan-again" />
            <Button title="Find by name" variant="secondary" onPress={() => router.push('/inventory/items')} />
          </View>
        </Card>
      ) : scan.isError ? (
        <ErrorState message={userMessage(scan.error)} onRetry={() => void scan.refetch()} />
      ) : (
        <>
          <Card testID="scan-hit">
            <View style={styles.stack}>
              <Text variant="caption" tone="muted">
                {scan.data.item.sku}
                {scan.data.item.barcode ? ` · ${scan.data.item.barcode}` : ''}
              </Text>
              <Text variant="heading">{scan.data.item.name}</Text>
              <View style={styles.kpis}>
                <KPI label="Available" value={quantity(scan.data.item.available, scan.data.item.unit)} tone={scan.data.item.belowReorder ? 'warning' : 'default'} />
                <KPI label="On hand" value={quantity(scan.data.item.onHand, scan.data.item.unit)} />
              </View>
              {scan.data.stock.length ? (
                scan.data.stock.map((row, i) => (
                  <View key={`${row.warehouseId}-${row.locationId ?? i}`} style={styles.row}>
                    <Text style={styles.grow}>{[row.warehouse, row.location].filter(Boolean).join(' · ')}</Text>
                    <Text tone="muted">{`${quantity(row.available, scan.data.item.unit)} of ${quantity(row.onHand, scan.data.item.unit)}`}</Text>
                  </View>
                ))
              ) : (
                <Text tone="muted">No stock in any warehouse.</Text>
              )}
            </View>
          </Card>
          <Button title="Open item" size="lg" fullWidth onPress={() => router.push(`/inventory/items/${scan.data.item.id}`)} testID="scan-open" />
          <Button title="Scan another" variant="secondary" onPress={() => { setCode(null); setTyped('') }} testID="scan-again" />
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  viewfinder: { height: 260, borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
})
