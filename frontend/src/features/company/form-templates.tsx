import { TemplateList } from '@/features/inspections/components/template-list'
import { CompanySection } from './components/company-section'

/** Company library of inspection / ITP / form / toolbox-talk templates. */
export function CompanyFormTemplates() {
  return (
    <CompanySection
      title='Inspection & form templates'
      description='Checklists every project can schedule from: inspections, ITPs with hold points, forms and toolbox talks. Projects copy a template to tailor it.'
    >
      <TemplateList projectId={null} canEdit />
    </CompanySection>
  )
}
