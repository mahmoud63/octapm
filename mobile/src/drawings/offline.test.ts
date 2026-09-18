import type { OfflineManifest } from '@/api/record-types'
import { keptState } from '@/drawings/offline'

const manifest: OfflineManifest = {
  generatedAt: '2026-09-18T00:00:00.000Z',
  items: [{ sheetId: 's1', number: 'S-101', title: 'Foundation plan', discipline: 'structural', revisionId: 'sr2', revision: 'C', documentId: 'doc2', pageNumber: 1, fileUrl: '/api/v1/x', fileName: 'S-101-C.pdf', sizeBytes: 1000, sha256: null, publishedAt: '2026-09-15T00:00:00.000Z' }],
  totals: { sheets: 1, documents: 1, bytes: 1000 },
}

describe('a sheet kept on the device', () => {
  it('is superseded once the server holds a different revision', () => {
    const state = keptState('s1', { s1: { revisionId: 'sr1', revision: 'B', keptAt: '2026-09-10T00:00:00.000Z', fileUri: 'file:///documents/offline-sheets/s1.pdf' } }, manifest)
    expect(state.superseded).toBe(true)
    expect(state.latest).toEqual({ revisionId: 'sr2', revision: 'C' })
  })

  it('is current while the revisions agree, and never superseded when nothing is kept or the manifest is unknown', () => {
    expect(keptState('s1', { s1: { revisionId: 'sr2', revision: 'C', keptAt: '2026-09-18T00:00:00.000Z', fileUri: null } }, manifest).superseded).toBe(false)
    expect(keptState('s1', {}, manifest).superseded).toBe(false)
    expect(keptState('s1', { s1: { revisionId: 'sr1', revision: 'B', keptAt: '2026-09-10T00:00:00.000Z', fileUri: null } }, undefined).superseded).toBe(false)
  })
})
