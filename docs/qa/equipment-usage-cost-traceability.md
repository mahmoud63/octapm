# Equipment Usage Cost Traceability QA

## Scope

Verify that equipment usage entered from daily reports remains provisional until PM approval, then posts to activity utilization, cost actuals, and audit history.

## Manual Scenario

1. Create or open a project with an active schedule activity.
2. Add equipment in the Equipment module with an hourly or daily rate.
3. Submit a daily activity report for the activity and select the equipment master item with non-zero hours.
4. Confirm the submitted daily report appears in the site-reporting review queue and the Equipment utilization dashboard has not changed yet.
5. Approve the daily report as PM.
6. Confirm the Equipment module shows approved hours, cost, recent usage, and utilization by activity.
7. Confirm Cost Control shows the equipment cost and actual cost increased for the linked activity, with actual-through date matching the daily report date.
8. Open audit history for the daily report, activity equipment usage, and cost record; confirm the usage line references the daily report and the cost record event references `daily_report.equipment_usage`.

## Expected Results

- Draft, rejected, and submitted daily-report equipment lines do not post official cost.
- Approved daily-report equipment lines create `ActivityEquipmentUsage` rows.
- Master-linked equipment lines calculate cost from equipment rate; unlisted rows show approved hours with zero cost until a rate/master link is corrected in a later workflow.
- Cost impact is traceable from the cost record audit event back to the source daily report.
