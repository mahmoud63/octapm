# BOQ AI Integration — Activity Generation & Dependencies

## Overview
After successful validation + calculation, the server sends the BOQ data to Claude AI. The AI splits each BOQ item into specific construction activities AND defines logical dependencies between them. The server assigns random alphanumeric Activity Codes to each AI-generated activity.

---

## What the AI Must Return

### Input (sent to AI)
```json
{
  "project": {
    "name": "Al Noor Hospital Tower",
    "startDate": "2026-06-01",
    "duration": 18,
    "durationUnit": "months",
    "currency": "AED",
    "totalBudget": 4580000
  },
  "boqItems": [
    {
      "code": "1.1",
      "description": "Site Clearance and Demolition",
      "quantity": 1200,
      "unit": "m²",
      "rate": 15,
      "amount": 18000
    },
    {
      "code": "1.2",
      "description": "Bulk Excavation",
      "quantity": 3500,
      "unit": "m³",
      "rate": 22,
      "amount": 77000
    }
  ]
}
```

### Expected AI Output Format
```json
{
  "boqActivities": [
    {
      "boqCode": "1.1",
      "activities": [
        {
          "activityName": "Vegetation removal and site hoarding",
          "unit": "m²",
          "quantity": 1200,
          "rate": 8,
          "dependencyType": null,
          "predecessorIndex": null
        },
        {
          "activityName": "Demolition of existing structures",
          "unit": "m²",
          "quantity": 1200,
          "rate": 7,
          "dependencyType": "FS",
          "predecessorIndex": 0
        }
      ]
    },
    {
      "boqCode": "1.2",
      "activities": [
        {
          "activityName": "Bulk excavation to formation level",
          "unit": "m³",
          "quantity": 2800,
          "rate": 22,
          "dependencyType": "FS",
          "predecessorIndex": null,
          "predecessorBoqCode": "1.1",
          "predecessorActivityIndex": 1
        },
        {
          "activityName": "Trim and prepare sub-grade",
          "unit": "m²",
          "quantity": 700,
          "rate": 0,
          "dependencyType": "SS",
          "predecessorIndex": 0
        }
      ]
    }
  ]
}
```

### Dependency Fields Explained
- `dependencyType`: `"FS"` (Finish-to-Start), `"SS"` (Start-to-Start), `null` (no dependency)
- `predecessorIndex`: index within the SAME BOQ item's activities array (0-based)
- `predecessorBoqCode` + `predecessorActivityIndex`: cross-BOQ-item dependency (optional — only when activity depends on an activity from a different BOQ item)

---

## AI Prompt Template

```javascript
// backend/services/ai/boq-activity-prompt.js

function buildBoqActivityPrompt(project, boqItems) {
  return `You are a construction project planning expert. Your task is to break down Bill of Quantities (BOQ) items into specific construction activities AND define logical dependencies between them.

RULES:
1. For each BOQ item, generate 1-5 specific construction activities
2. Activities must be practical, sequential construction tasks
3. Define ONLY these dependency types:
   - "FS" (Finish-to-Start): Activity B cannot start until Activity A finishes
   - "SS" (Start-to-Start): Activity B can start when Activity A starts
   - null: No dependency, can start any time
4. The first activity in each BOQ item typically has no dependency within that item (null) but may depend on a previous BOQ item's activities
5. Activity names must be specific, max 255 characters
6. Keep unit and quantity realistic relative to the BOQ item
7. Quantities across activities under one BOQ item should logically relate to the BOQ item's total quantity

PROJECT CONTEXT:
- Name: ${project.name}
- Start Date: ${project.startDate}
- Duration: ${project.duration} ${project.durationUnit}
- Total Budget: ${project.currency} ${project.totalBudget.toLocaleString()}

BOQ ITEMS:
${JSON.stringify(boqItems, null, 2)}

Respond ONLY with valid JSON matching this exact structure:
{
  "boqActivities": [
    {
      "boqCode": "<exact code from input>",
      "activities": [
        {
          "activityName": "<max 255 chars>",
          "unit": "<unit string>",
          "quantity": <number>,
          "rate": <number>,
          "dependencyType": "FS" | "SS" | null,
          "predecessorIndex": <index in this item's activities, 0-based> | null,
          "predecessorBoqCode": "<boq code of predecessor if cross-item>" | null,
          "predecessorActivityIndex": <index in predecessor BOQ item's activities> | null
        }
      ]
    }
  ]
}

Do not include any explanation, markdown, or text outside the JSON.`
}
```

---

## Activity Code Generator (Backend)

Random alphanumeric code, format: `AC-XXXXX` (5 alphanumeric chars, uppercase).

```javascript
// backend/utils/activity-code.js

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0,O,1,I to avoid confusion

function generateActivityCode() {
  let code = 'AC-'
  for (let i = 0; i < 5; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return code
}

async function generateUniqueActivityCode(projectId, db) {
  let code
  let attempts = 0
  do {
    code = generateActivityCode()
    const existing = await db.query(
      'SELECT id FROM boq_activities WHERE project_id = $1 AND activity_code = $2',
      [projectId, code]
    )
    attempts++
    if (attempts > 100) throw new Error('Failed to generate unique activity code')
  } while (existing.rows.length > 0)
  return code
}
```

---

## Backend Processing Flow

```javascript
// backend/services/boq.service.js — processBoqUpload()

async function processBoqUpload(projectId, file, label) {
  // Step 1: Parse Excel
  const rawRows = parseExcelFile(file)

  // Step 2: Validate
  const validation = validateBoqRows(rawRows)
  if (!validation.valid) {
    throw { code: 'BOQ_VALIDATION_FAILED', errors: validation.errors, statusCode: 400 }
  }

  // Step 3: Calculate amounts
  const itemsWithAmounts = rawRows.map(row => ({
    code: row.Code,
    description: row.Description,
    quantity: Number(row.Quantity),
    unit: row.Unit,
    rate: Number(row.Rate),
    amount: Number(row.Quantity) * Number(row.Rate),
    isManual: false,
  }))

  // Step 4: Calculate financials
  const financial = await calculateBoqFinancials(projectId, itemsWithAmounts)

  // Step 5: Persist BOQ items (no activities yet)
  await db.transaction(async trx => {
    await trx.query('DELETE FROM boq_items WHERE project_id = $1 AND is_manual = FALSE', [projectId])
    for (const item of itemsWithAmounts) {
      await trx.query(
        'INSERT INTO boq_items (project_id, code, description, quantity, unit, rate, amount, is_manual, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,$8)',
        [projectId, item.code, item.description, item.quantity, item.unit, item.rate, item.amount, itemsWithAmounts.indexOf(item)]
      )
    }
  })

  // Step 6: Start async AI job (return jobId immediately)
  const jobId = await createJob(projectId, 'boq-generate')
  processBoqAiAsync(projectId, jobId, itemsWithAmounts, financial, label)
  return { jobId }
}

async function processBoqAiAsync(projectId, jobId, items, financial, label) {
  try {
    await updateJob(jobId, { status: 'running', step: 'Calling AI to generate activities…' })

    // Step 7: Call Claude AI
    const project = await getProject(projectId)
    const prompt = buildBoqActivityPrompt(project, items)
    const aiResponse = await callClaude(prompt)
    const parsed = JSON.parse(aiResponse)

    await updateJob(jobId, { step: 'Saving activities…', progress: 70 })

    // Step 8: Save activities with generated codes
    for (const boqResult of parsed.boqActivities) {
      const boqItem = await db.query(
        'SELECT id FROM boq_items WHERE project_id = $1 AND code = $2',
        [projectId, boqResult.boqCode]
      )
      if (!boqItem.rows[0]) continue

      const savedCodes = [] // track codes for predecessor linking
      for (let i = 0; i < boqResult.activities.length; i++) {
        const act = boqResult.activities[i]
        const activityCode = await generateUniqueActivityCode(projectId, db)
        savedCodes.push(activityCode)

        // Resolve predecessor
        let predecessorCode = null
        if (act.predecessorIndex !== null && act.predecessorIndex !== undefined) {
          predecessorCode = savedCodes[act.predecessorIndex] || null
        }
        // Cross-item predecessor would require looking up already-saved activities

        await db.query(
          `INSERT INTO boq_activities 
            (boq_item_id, project_id, activity_code, activity_name, unit, quantity, rate, budget, dependency_type, predecessor_code, is_manual, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE,$11)`,
          [
            boqItem.rows[0].id, projectId, activityCode, act.activityName,
            act.unit, act.quantity, act.rate, act.quantity * act.rate,
            act.dependencyType, predecessorCode, i,
          ]
        )
      }
    }

    await updateJob(jobId, { status: 'done', step: 'Complete', progress: 100 })
  } catch (err) {
    await updateJob(jobId, { status: 'error', error: err.message || 'AI processing failed' })
  }
}
```

---

## Error Handling

If Claude API returns non-JSON or 500 error:
```javascript
// Show to user:
"AI processing failed. Please try uploading again."
// Do NOT leave user on infinite loading screen
// Set job.status = 'error' with the message above
// BOQ items remain saved (validation + calc already done)
// User can retry by uploading same file again (idempotent — deletes non-manual rows first)
```
