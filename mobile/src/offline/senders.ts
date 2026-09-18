/**
 * How each queued kind is sent. Every one carries the replay key it was
 * captured with, so a repeat after a lost reply lands once on the server.
 * A dependant (a photo for a punch item) takes the id its parent was given.
 */
import { isAppError } from '@/api/errors'
import { postGoodsReceipt } from '@/api/inventory-endpoints'
import type { GoodsReceiptInput } from '@/api/inventory-types'
import { createForm, createPunch } from '@/api/quality-endpoints'
import type { FormCreate, PunchCreate } from '@/api/quality-types'
import { keys, queryClient } from '@/api/query'
import { uploadAttachments } from '@/api/record-endpoints'
import { addDailyLogEntry, createTimesheet } from '@/api/site-endpoints'
import type { DailyLogSection, EntryInput, TimesheetEntry } from '@/api/site-types'
import { registerSender, type OutboxItem } from '@/offline/outbox'

const refresh = (projectId: string) => {
  void queryClient.invalidateQueries({ queryKey: keys.project(projectId) })
  void queryClient.invalidateQueries({ queryKey: keys.needsYou(projectId) })
}

export interface QueuedFile {
  uri: string
  name: string
  type: string
}

/** Wire every kind once; the engine looks them up by name. */
export function registerSenders() {
  registerSender('punch.create', async (item) => {
    const created = await createPunch(item.projectId, item.payload.body as PunchCreate)
    refresh(item.projectId)
    return { resultId: created.id }
  })

  registerSender('form.create', async (item) => {
    const created = await createForm(item.projectId, item.payload.body as FormCreate)
    refresh(item.projectId)
    return { resultId: created.id }
  })

  registerSender('daily-log.entry', async (item) => {
    const { date, section, body } = item.payload as { date: string; section: DailyLogSection; body: EntryInput }
    await addDailyLogEntry(item.projectId, date, section, body)
    refresh(item.projectId)
    return { resultId: null }
  })

  registerSender('timesheet.create', async (item) => {
    const created = await createTimesheet(item.projectId, item.payload.body as { date: string; crewId?: string; companyId?: string; notes?: string; defaultHours?: number; clientRequestId: string; entries: TimesheetEntry[] })
    refresh(item.projectId)
    return { resultId: created.id }
  })

  registerSender('attachment.upload', async (item, parent) => {
    const payload = item.payload as { recordType: string; recordId: string | null; role?: 'attachment' | 'evidence' | 'photo' | 'reference'; caption?: string; files: QueuedFile[] }
    const recordId = payload.recordId ?? parent?.resultId ?? null
    if (!recordId) throw new Error('The record this photo belongs to has no id yet.')
    await uploadAttachments(item.projectId, { recordType: payload.recordType, recordId, role: payload.role, caption: payload.caption, clientRequestId: item.clientRequestId, files: payload.files })
    refresh(item.projectId)
    return { resultId: null }
  })

  registerSender('goods-receipt', async (item: OutboxItem) => {
    const body = item.payload.body as GoodsReceiptInput
    try {
      const result = await postGoodsReceipt(body)
      refresh(item.projectId)
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      return { resultId: result.receiptId }
    } catch (error) {
      // The number is the natural key: the server already holds this receipt, so the earlier send counted.
      if (isAppError(error) && error.serverCode === 'RECEIPT_ALREADY_POSTED') {
        refresh(item.projectId)
        return { resultId: ((error.details ?? {}) as { receiptId?: string }).receiptId ?? null }
      }
      throw error
    }
  })
}
