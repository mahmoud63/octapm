/** Server state for the quality screens (M4). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { keys } from '@/api/query'
import {
  addFormSignature,
  completeForm,
  createForm,
  createMaterialTest,
  createNcr,
  createPunch,
  createSafety,
  formAction,
  getForm,
  getPunch,
  getQualityDashboard,
  listFormTemplates,
  listForms,
  listMaterialTests,
  listNcrs,
  listPunch,
  listSafety,
  ncrDecision,
  raiseDeficiency,
  recordMaterialTest,
  safetyDecision,
  saveFormResponses,
  startForm,
  submitNcrCloseout,
  submitSafetyCloseout,
  transitionPunch,
  uploadWorkflowFiles,
  type FormFilters,
  type PunchFilters,
} from '@/api/quality-endpoints'
import type { CloseoutInput, FormCreate, FormInstance, NcrCreate, PunchAction, PunchCreate, PunchItem, SafetyCreate } from '@/api/quality-types'

const scoped = (projectId: string, ...rest: readonly unknown[]) => keys.projectScoped(projectId, ...rest)

export function useQualityDashboard(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'quality', 'dashboard'), queryFn: ({ signal }) => getQualityDashboard(projectId!, signal), enabled: !!projectId })
}

// ── Inspections ──

export function useFormTemplates(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'forms', 'templates'), queryFn: ({ signal }) => listFormTemplates(projectId!, signal), enabled: !!projectId, select: (d) => d.items, staleTime: 10 * 60_000 })
}

export function useForms(projectId: string | null, filters: FormFilters = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'forms', filters), queryFn: ({ signal }) => listForms(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function useForm(projectId: string | null, instanceId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'form', instanceId), queryFn: ({ signal }) => getForm(projectId!, instanceId!, signal), enabled: !!projectId && !!instanceId })
}

export function useFormActions(projectId: string) {
  const client = useQueryClient()
  const put = (instance: FormInstance) => {
    client.setQueryData(scoped(projectId, 'form', instance.id), instance)
    void client.invalidateQueries({ queryKey: scoped(projectId, 'forms') })
    void client.invalidateQueries({ queryKey: scoped(projectId, 'quality') })
  }
  const create = useMutation({ mutationFn: (body: FormCreate) => createForm(projectId, body), onSuccess: put })
  const start = useMutation({ mutationFn: (instanceId: string) => startForm(projectId, instanceId), onSuccess: put })
  const save = useMutation({ mutationFn: ({ instanceId, responses }: { instanceId: string; responses: { itemId: string; value: string | number | boolean | null; note?: string }[] }) => saveFormResponses(projectId, instanceId, responses), onSuccess: put })
  const complete = useMutation({ mutationFn: (instanceId: string) => completeForm(projectId, instanceId), onSuccess: put })
  const act = useMutation({ mutationFn: ({ instanceId, action, reason }: { instanceId: string; action: 'close' | 'reopen' | 'void'; reason?: string }) => formAction(projectId, instanceId, action, reason), onSuccess: put })
  const deficiency = useMutation({
    mutationFn: ({ instanceId, itemId, body }: { instanceId: string; itemId: string; body: Parameters<typeof raiseDeficiency>[3] }) => raiseDeficiency(projectId, instanceId, itemId, body),
    onSuccess: (data) => {
      put(data.instance)
      void client.invalidateQueries({ queryKey: scoped(projectId, 'punch') })
    },
  })
  const sign = useMutation({ mutationFn: ({ instanceId, body }: { instanceId: string; body: Parameters<typeof addFormSignature>[2] }) => addFormSignature(projectId, instanceId, body), onSuccess: (data) => put(data.instance) })
  return { create, start, save, complete, act, deficiency, sign }
}

// ── Punch ──

export function usePunchList(projectId: string | null, filters: PunchFilters = {}) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'punch', filters), queryFn: ({ signal }) => listPunch(projectId!, filters, signal), enabled: !!projectId, placeholderData: (previous) => previous })
}

export function usePunchItem(projectId: string | null, itemId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'punch-item', itemId), queryFn: ({ signal }) => getPunch(projectId!, itemId!, signal), enabled: !!projectId && !!itemId })
}

export function usePunchActions(projectId: string) {
  const client = useQueryClient()
  const put = (item: PunchItem) => {
    client.setQueryData(scoped(projectId, 'punch-item', item.id), item)
    void client.invalidateQueries({ queryKey: scoped(projectId, 'punch') })
    void client.invalidateQueries({ queryKey: scoped(projectId, 'quality') })
    void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
  }
  const create = useMutation({ mutationFn: (body: PunchCreate) => createPunch(projectId, body), onSuccess: put })
  const transition = useMutation({ mutationFn: ({ itemId, action, reason }: { itemId: string; action: PunchAction; reason?: string }) => transitionPunch(projectId, itemId, action, reason), onSuccess: put })
  return { create, transition }
}

// ── NCR and safety (lists only on the server; records come from the list) ──

export function useNcrs(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'ncrs'), queryFn: ({ signal }) => listNcrs(projectId!, signal), enabled: !!projectId })
}

export function useNcrActions(projectId: string) {
  const client = useQueryClient()
  const settle = () => {
    void client.invalidateQueries({ queryKey: scoped(projectId, 'ncrs') })
    void client.invalidateQueries({ queryKey: scoped(projectId, 'quality') })
    void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
  }
  const create = useMutation({ mutationFn: (body: NcrCreate) => createNcr(projectId, body), onSuccess: settle })
  const submit = useMutation({ mutationFn: ({ ncrId, body }: { ncrId: string; body: CloseoutInput }) => submitNcrCloseout(projectId, ncrId, body), onSuccess: settle })
  const decide = useMutation({ mutationFn: ({ ncrId, action, text }: { ncrId: string; action: 'approve' | 'reject' | 'reopen'; text?: string }) => ncrDecision(projectId, ncrId, action, text), onSuccess: settle })
  return { create, submit, decide }
}

export function useSafetyList(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'safety'), queryFn: ({ signal }) => listSafety(projectId!, signal), enabled: !!projectId })
}

export function useSafetyActions(projectId: string) {
  const client = useQueryClient()
  const settle = () => {
    void client.invalidateQueries({ queryKey: scoped(projectId, 'safety') })
    void client.invalidateQueries({ queryKey: scoped(projectId, 'quality') })
    void client.invalidateQueries({ queryKey: keys.needsYou(projectId) })
  }
  const create = useMutation({ mutationFn: (body: SafetyCreate) => createSafety(projectId, body), onSuccess: settle })
  const submit = useMutation({ mutationFn: ({ incidentId, body }: { incidentId: string; body: CloseoutInput }) => submitSafetyCloseout(projectId, incidentId, body), onSuccess: settle })
  const decide = useMutation({ mutationFn: ({ incidentId, action, text }: { incidentId: string; action: 'approve' | 'reject' | 'reopen'; text?: string }) => safetyDecision(projectId, incidentId, action, text), onSuccess: settle })
  return { create, submit, decide }
}

export function useWorkflowUpload(projectId: string) {
  return useMutation({ mutationFn: (files: { uri: string; name: string; type: string }[] | File[]) => uploadWorkflowFiles(projectId, files) })
}

// ── Material tests ──

export function useMaterialTests(projectId: string | null) {
  return useQuery({ queryKey: scoped(projectId ?? 'none', 'material-tests'), queryFn: ({ signal }) => listMaterialTests(projectId!, signal), enabled: !!projectId })
}

export function useMaterialTestActions(projectId: string) {
  const client = useQueryClient()
  const settle = () => {
    void client.invalidateQueries({ queryKey: scoped(projectId, 'material-tests') })
    void client.invalidateQueries({ queryKey: scoped(projectId, 'quality') })
  }
  const create = useMutation({ mutationFn: (body: Parameters<typeof createMaterialTest>[1]) => createMaterialTest(projectId, body), onSuccess: settle })
  const record = useMutation({ mutationFn: ({ testId, body }: { testId: string; body: Parameters<typeof recordMaterialTest>[2] }) => recordMaterialTest(projectId, testId, body), onSuccess: settle })
  return { create, record }
}
