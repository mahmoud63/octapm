# Task 03 — Schedule Generation: Full Input Validation (FR-103)

## Gap Covered
- Pre-generation validation: project name required, start date required, duration > 0, ≥2 BOQ items with descriptions, no negative quantities/rates, all described items must have a section

## BRD Refs
- FR-103: Before generation, validate: project name required, start date required, duration > 0, at least 2 BOQ items with descriptions, no negative quantities or rates, all described items must have a section assigned

## DB Schema Changes
None required.

## Backend Changes

### File: `backend/src/services/schedule.service.js`

Add a `validateForGeneration` function called at the start of `startGenerateJob`:

```js
function validateForGeneration(project, boqRows) {
  const errors = [];

  if (!project.name || !project.name.trim()) {
    errors.push('Project name is required');
  }
  if (!project.startDate) {
    errors.push('Project start date is required');
  }
  if (!project.duration || project.duration <= 0) {
    errors.push('Project duration must be greater than 0');
  }

  const describedRows = boqRows.filter(r => r.description && String(r.description).trim());
  if (describedRows.length < 2) {
    errors.push('At least 2 BOQ items with descriptions are required');
  }

  const negativeQty = boqRows.find(r => Number(r.qty) < 0);
  if (negativeQty) {
    errors.push(`Negative quantity found: "${negativeQty.description}"`);
  }

  const negativeRate = boqRows.find(r => Number(r.rate) < 0);
  if (negativeRate) {
    errors.push(`Negative rate found: "${negativeRate.description}"`);
  }

  const missingSection = describedRows.find(r => !r.section || !String(r.section).trim());
  if (missingSection) {
    errors.push(`Item missing section/phase: "${String(missingSection.description).slice(0, 40)}"`);
  }

  return errors;
}
```

In `startGenerateJob`, after `structureBoqRows` returns, call validation:
```js
const boqRows = await structureBoqRows(rawText);
const validationErrors = validateForGeneration(project, boqRows);
if (validationErrors.length > 0) {
  return setJob(jobId, {
    status: 'error',
    error: `Validation failed:\n• ${validationErrors.join('\n• ')}`,
  });
}
```

Note: validation runs *after* AI BOQ parsing (so we have structured rows with sections). This is intentional — the file may not have sections pre-labelled but the AI assigns them. If the AI fails to assign sections, validation will catch it.

## Frontend Changes

### File: `frontend/src/features/schedule/components/schedule-upload-zone.tsx`
The existing error state already displays `error` from the job poller as text. Validation errors from the backend will be shown automatically via the `toast.error(error)` effect.

However, add a **pre-upload readiness check** based on project data:

```tsx
// Add to ScheduleUploadZone props
interface Props {
  projectId: string
  project: { name?: string; startDate?: string | null; duration?: number | null }
}

// Before allowing file upload, check locally:
const readinessIssues: string[] = []
if (!project.name) readinessIssues.push('Project name missing')
if (!project.startDate) readinessIssues.push('Project start date missing — edit project to set it')
if (!project.duration) readinessIssues.push('Project duration missing — edit project to set it')

// Show warning banner if issues exist
{readinessIssues.length > 0 && (
  <div className='mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'>
    <p className='font-semibold mb-1'>Before uploading, fix these:</p>
    <ul className='list-disc list-inside space-y-0.5'>
      {readinessIssues.map(i => <li key={i}>{i}</li>)}
    </ul>
  </div>
)}
```

### File: `frontend/src/features/projects/components/project-detail.tsx`
Pass `project` to `ScheduleUploadZone`:
```tsx
<ScheduleUploadZone projectId={projectId} project={project} />
```

## Acceptance Criteria
- [ ] Uploading a file for a project with no start date returns a clear validation error
- [ ] Uploading a file for a project with duration=0 returns a clear validation error
- [ ] BOQ with 1 described item returns "At least 2 BOQ items required"
- [ ] BOQ items with negative rates/quantities are flagged
- [ ] Pre-upload warning banner shows if project is missing name/date/duration
- [ ] Valid project + valid BOQ proceeds normally
