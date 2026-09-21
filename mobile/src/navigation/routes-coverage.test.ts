import fs from 'node:fs'
import path from 'node:path'
import { ALL_SLOT_NAMES, HIDDEN_ROUTES } from '@/navigation/roleNav'

const APP = path.join(__dirname, '..', '..', 'app', '(app)')

/**
 * The route names expo-router gives the signed-in tab navigator.
 *
 * A folder with its own _layout is one route, named after the folder. A folder
 * without one hands every file inside it to the tabs separately — `team/index`
 * and `team/[id]` as two tabs — and a plain file is a route by its own name.
 */
function tabRouteNames(dir: string, prefix = ''): string[] {
  const names: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('+')) continue
    if (entry.isDirectory()) {
      const inside = path.join(dir, entry.name)
      const hasLayout = fs.existsSync(path.join(inside, '_layout.tsx'))
      names.push(...(hasLayout ? [`${prefix}${entry.name}`] : tabRouteNames(inside, `${prefix}${entry.name}/`)))
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      names.push(`${prefix}${entry.name.replace(/\.tsx$/, '')}`)
    }
  }
  return names
}

describe('every signed-in route is either on the bar or deliberately off it', () => {
  it('leaves nothing for expo-router to put on the tab bar by default', () => {
    // A route that is neither some role's slot nor hidden does not fail — it
    // just appears as an extra tab for everyone. Five did, with a bare
    // triangle for an icon, before this test existed.
    const known = new Set([...ALL_SLOT_NAMES, ...HIDDEN_ROUTES])
    const stray = tabRouteNames(APP).filter((name) => !known.has(name))
    expect(stray).toEqual([])
  })

  it('names no route that does not exist', () => {
    // The other direction: a hidden entry for a route that was removed is
    // harmless to people but means the list has stopped describing the app.
    const present = new Set(tabRouteNames(APP))
    expect(HIDDEN_ROUTES.filter((name) => !present.has(name))).toEqual([])
  })
})
