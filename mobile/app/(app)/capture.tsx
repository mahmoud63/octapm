import { Redirect, useLocalSearchParams } from 'expo-router'

/**
 * The centre slot. Pressing it opens the capture sheet from the shell, so this
 * screen is normally never seen; it exists because a tab needs a route. A link
 * that lands here means someone asked to capture something, and a photograph
 * is what that means — carrying whatever context the link brought with it.
 */
export default function CaptureRoute() {
  const params = useLocalSearchParams<{ recordType?: string; recordId?: string; recordRef?: string; locationId?: string }>()
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
  ).toString()
  return <Redirect href={`/photos/new${query ? `?${query}` : ''}` as never} />
}
