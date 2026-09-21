import * as ImagePicker from 'expo-image-picker'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Image, Platform, StyleSheet, View } from 'react-native'
import { userMessage } from '@/api/errors'
import { uploadAttachments } from '@/api/record-endpoints'
import { useLocations } from '@/api/record-hooks'
import { keys, queryClient } from '@/api/query'
import { PickerField } from '@/components/PickerField'
import { Screen } from '@/components/Screen'
import { Button, Card, Input, Text, spacing, useTheme } from '@/design-system'
import { captureOrQueue, keepFilesForQueue } from '@/offline/capture'
import { useProjectStore } from '@/projects/store'
import { newId } from '@/utilities/id'

// Loaded only on a device: the web target has no viewfinder, and the test runner fakes it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const camera = Platform.OS === 'web' ? null : (require('expo-camera') as typeof import('expo-camera'))

interface Shot {
  uri: string
  name: string
  type: string
}

/**
 * Take a photograph, look at it, then say what it is.
 *
 * The camera opens first because that is what the person came to do, and
 * nothing is sent until they have seen the picture and agreed to it: a
 * photograph taken into a pocket, or of a thumb, is worse than none at all
 * once it is filed against a record. So the order is camera, then the still
 * with Retake beside Use, and only then the caption.
 *
 * Context is inherited rather than asked for. Arriving from an NCR, a location
 * or the day's report, this already knows where the photograph belongs and
 * says so in a sentence; the only thing left to choose is the place, and only
 * when nothing told us.
 */
export default function CapturePhotoScreen() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ recordType?: string; recordId?: string; recordRef?: string; locationId?: string }>()
  const projectId = useProjectStore((s) => s.currentProjectId)
  const locations = useLocations(projectId)

  const [shot, setShot] = useState<Shot | null>(null)
  const [caption, setCaption] = useState('')
  const [locationId, setLocationId] = useState<string | null>(params.locationId ?? null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const cameraRef = useRef<InstanceType<NonNullable<typeof camera>['CameraView']> | null>(null)

  // What this photograph is going onto. Without a record it belongs to the
  // project itself, which the photo register is the home of.
  const recordType = params.recordType ?? 'project'
  const recordId = params.recordId ?? projectId ?? ''
  const belongsTo = params.recordRef ?? (params.recordType ? params.recordType.replace(/_/g, ' ') : 'this project')

  const pickOnWeb = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 })
    // Changing their mind leaves them here, with the button still in front of
    // them; it does not throw them off the screen they deliberately opened.
    if (picked.canceled || !picked.assets[0]) return
    const asset = picked.assets[0]
    setShot({ uri: asset.uri, name: asset.fileName ?? `photo-${newId()}.jpg`, type: asset.mimeType ?? 'image/jpeg' })
  }

  const save = async () => {
    if (!shot || !projectId || !recordId) return
    setFailure(null)
    setBusy(true)
    const clientRequestId = newId()
    try {
      const outcome = await captureOrQueue(
        {
          projectId,
          kind: 'attachment.upload',
          summary: `Photograph for ${belongsTo}`,
          clientRequestId,
          payload: { recordType, recordId, recordRef: params.recordRef ?? null, role: 'photo', caption: caption.trim() || null, locationId, files: await keepFilesForQueue([shot]) },
        },
        async () => {
          await uploadAttachments(projectId, {
            recordType,
            recordId,
            role: 'photo',
            caption: caption.trim() || undefined,
            locationId,
            clientRequestId,
            files: Platform.OS === 'web' ? [new File([await (await fetch(shot.uri)).blob()], shot.name, { type: shot.type })] : [shot],
          })
          return true
        },
      )
      if (outcome.queued) {
        setQueued(true)
        return
      }
      void queryClient.invalidateQueries({ queryKey: keys.projectScoped(projectId, 'photos') })
      void queryClient.invalidateQueries({ queryKey: keys.projectScoped(projectId, 'attachments', recordType, recordId) })
      router.back()
    } catch (error) {
      setFailure(userMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (queued) {
    return (
      <Screen title="Photograph" contentStyle={styles.content} testID="screen-capture">
        <Card edge={theme.colors.warning} testID="capture-queued">
          <View style={styles.stack}>
            <Text>Kept on this device — it will be added to {belongsTo} when the signal returns.</Text>
            <Button title="Waiting to send" variant="secondary" onPress={() => router.replace('/outbox')} testID="capture-open-outbox" />
            <Button title="Done" onPress={() => router.back()} testID="capture-done" />
          </View>
        </Card>
      </Screen>
    )
  }

  // ── The still, with the way back to the camera beside the way on ──────────
  if (shot) {
    return (
      <Screen title="Photograph" contentStyle={styles.content} testID="screen-capture">
        <View style={[styles.preview, { borderColor: theme.colors.border }]} testID="capture-preview">
          <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="The photograph just taken" />
        </View>

        <Card testID="capture-context">
          <View style={styles.stack}>
            <Text variant="label" label tone="muted">
              Goes onto
            </Text>
            <Text testID="capture-belongs">{belongsTo}</Text>
            <PickerField
              label="Where"
              placeholder={locations.data?.length ? 'Choose a location' : 'No locations on this project'}
              options={(locations.data ?? []).map((l) => ({ id: l.id, label: l.name, sublabel: l.fullName }))}
              value={locationId}
              onChange={(value) => setLocationId(typeof value === 'string' ? value : null)}
              loading={locations.isPending}
              testID="capture-location"
            />
            <Input label="Caption" placeholder="What does this show?" value={caption} onChangeText={setCaption} testID="capture-caption" />
          </View>
        </Card>

        {failure ? (
          <Text tone="error" accessibilityRole="alert" testID="capture-failure">
            {failure}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button title="Retake" variant="secondary" onPress={() => setShot(null)} testID="capture-retake" />
          <Button title="Use this photograph" size="lg" fullWidth loading={busy} onPress={() => void save()} testID="capture-save" />
        </View>
      </Screen>
    )
  }

  // ── The camera itself ────────────────────────────────────────────────────
  return (
    <Screen title="Take a photograph" contentStyle={styles.content} testID="screen-capture">
      {camera ? (
        <NativeCamera
          onShot={(uri) => setShot({ uri, name: `photo-${newId()}.jpg`, type: 'image/jpeg' })}
          cameraRef={cameraRef}
        />
      ) : (
        <Card testID="capture-web">
          <View style={styles.stack}>
            <Text tone="muted">This build has no viewfinder, so the photograph comes from the device.</Text>
            <Button title="Choose a photograph" onPress={() => void pickOnWeb()} testID="capture-choose" />
          </View>
        </Card>
      )}
    </Screen>
  )
}

/** Only ever rendered where `expo-camera` loaded, so the non-null assertions hold. */
function NativeCamera({ onShot, cameraRef }: { onShot: (uri: string) => void; cameraRef: React.MutableRefObject<InstanceType<NonNullable<typeof camera>['CameraView']> | null> }) {
  const theme = useTheme()
  const [permission, request] = camera!.useCameraPermissions()
  const [busy, setBusy] = useState(false)

  if (!permission) return null
  if (!permission.granted) {
    return (
      <Card>
        <View style={styles.stack}>
          <Text>OctaPM needs the camera to photograph the work.</Text>
          <Button title={permission.canAskAgain ? 'Allow the camera' : 'Open Settings to allow the camera'} onPress={() => void request()} testID="capture-allow" />
        </View>
      </Card>
    )
  }

  const CameraView = camera!.CameraView
  return (
    <>
      <View style={[styles.preview, { borderColor: theme.colors.border }]} testID="capture-camera">
        <CameraView ref={cameraRef as never} style={StyleSheet.absoluteFill} facing="back" />
      </View>
      <Button
        title="Take the photograph"
        size="lg"
        fullWidth
        loading={busy}
        onPress={() => {
          setBusy(true)
          void (async () => {
            try {
              const taken = await (cameraRef.current as unknown as { takePictureAsync: (o: { quality: number }) => Promise<{ uri: string }> } | null)?.takePictureAsync({ quality: 0.7 })
              if (taken?.uri) onShot(taken.uri)
            } finally {
              setBusy(false)
            }
          })()
        }}
        testID="capture-shutter"
      />
    </>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  stack: { gap: spacing.sm },
  preview: { height: 320, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  actions: { gap: spacing.sm },
})
