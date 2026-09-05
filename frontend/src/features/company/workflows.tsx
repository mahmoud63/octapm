import { WorkflowTemplateList } from '@/features/workflows/components/workflow-template-editor'
import { CompanySection } from './components/company-section'

/** Company library of configurable approval workflows. */
export function CompanyWorkflows() {
  return (
    <CompanySection
      title='Workflows'
      description='Approval routes for change orders, commitments, pay applications, certificates, budget revisions, submittals, correspondence and drawings. Rules pick the route for a record; steps decide, branch or notify; the end approves or returns the record.'
    >
      <WorkflowTemplateList projectId={null} canEdit />
    </CompanySection>
  )
}
