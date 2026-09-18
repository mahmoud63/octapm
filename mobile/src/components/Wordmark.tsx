import { Image } from 'expo-image'
import { View } from 'react-native'
import { Text } from '@/design-system'

/**
 * The OctaPM lockup: the eight-octagon ring beside the name.
 *
 * The ring is the icon asset rendered from the brand vectors; the name is set
 * in the display face. The brand's custom lettering is not a font, so the
 * exact wordmark stays on the web and on the app icon, and the app's own
 * chrome uses this pairing.
 */
export function Wordmark({ color = '#fff', height = 28 }: { color?: string; height?: number }) {
  return (
    <View accessibilityRole="image" accessibilityLabel="OctaPM" style={{ flexDirection: 'row', alignItems: 'center', gap: height * 0.35 }}>
      <Image source={require('../../assets/splash-icon.png')} style={{ width: height * 1.5, height: height * 1.5, tintColor: color }} contentFit="contain" />
      <Text variant="title" style={{ color, fontSize: height, lineHeight: height * 1.2, letterSpacing: -0.5 }}>
        octapm
      </Text>
    </View>
  )
}
