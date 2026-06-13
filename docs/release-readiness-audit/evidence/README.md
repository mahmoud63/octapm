# Release Evidence Archive

Generated UAT evidence for `TASK-P1-QA-001` is written here by:

```bash
npm run test:e2e:uat
```

Each full run writes a JSON summary named `TASK-P1-QA-001-uat-regression-<run-id>.json` and browser screenshots under `screenshots/`. CI also uploads this directory as a workflow artifact when the staging UAT job runs.

Do not put secrets, raw bearer tokens, refresh cookies, or private uploaded files in this folder.
