import { useEffect, useRef } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Screen } from '@/components/Screen'
import { SkeletonList } from '@/design-system'
import { resolveLink, routeForResolvedLink } from '@/navigation/deepLinks'
import { useProjectStore } from '@/projects/store'

/**
 * The opener behind deep links, universal links and notification taps. It
 * switches to the project the link names (dropping the previous project's
 * cached records, as the Projects screen does) and then replaces itself
 * with the record's route, so back lands on the record's own list.
 *
 * `to` is an app route; `link` is any link form the resolver accepts and is
 * what the web target uses, where the native intent hook does not run.
 */
export default function OpenLinkScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ to?: string; projectId?: string; link?: string }>()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const run = async () => {
      let route = typeof params.to === 'string' && params.to ? params.to : null
      let projectId = typeof params.projectId === 'string' && params.projectId ? params.projectId : null
      if (!route && typeof params.link === 'string' && params.link) {
        const resolved = resolveLink(params.link)
        if (resolved) {
          route = resolved.route
          projectId = resolved.projectId
        }
      }
      if (!route || !route.startsWith('/') || route.startsWith('//')) {
        router.replace('/')
        return
      }
      const store = useProjectStore.getState()
      if (projectId && projectId !== store.currentProjectId) await store.select(projectId)
      router.replace(routeForResolvedLink({ route, projectId: null }, null) as never)
    }
    void run()
  }, [params.link, params.projectId, params.to, router])

  return (
    <Screen testID="screen-open">
      <SkeletonList rows={3} />
    </Screen>
  )
}
