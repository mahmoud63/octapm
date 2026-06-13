# Publish Readiness Checklist

## Product Readiness
- [ ] All P0 tasks complete.
- [ ] All P1 tasks complete or formally risk-accepted.
- [ ] Feature audit matrix updated after fixes.
- [ ] Known limitations approved by Product and Business.
- [ ] Pilot/customer scope approved.

## Technical Readiness
- [ ] Backend Jest passes.
- [ ] Frontend lint, typecheck, and build pass.
- [ ] Prisma validation passes.
- [ ] OpenAPI validation passes.
- [ ] Secret hygiene and private storage validators pass.
- [ ] Release branch has clean git status.

## Security Readiness
- [ ] Production secrets stored in approved secret manager.
- [ ] No secret values printed in docs/logs.
- [ ] CORS origins are HTTPS and approved.
- [ ] JWT, refresh, CloudFront, Stripe, and storage secrets are distinct and rotated.
- [ ] Permission-negative tests pass.
- [ ] File access negative tests pass.

## Legal / Compliance Readiness
- [ ] Data retention and archive policy approved.
- [ ] Customer terms and pilot limitations approved.
- [ ] Privacy/security obligations reviewed.
- [ ] Financial/audit workflow limitations disclosed until fully certified.

## Deployment Readiness
- [ ] Terraform init/validate passes.
- [ ] Staging deployment rehearsal passes.
- [ ] Production deployment plan approved.
- [ ] Smoke tests documented.
- [ ] Rollback path rehearsed.

## Support Readiness
- [ ] Support runbook complete.
- [ ] Escalation owners named.
- [ ] Incident response process documented.
- [ ] Customer onboarding flow documented.
- [ ] Known limitations/support FAQs published.

## Documentation Readiness
- [ ] Root README exists.
- [ ] Environment variable guide complete without secret values.
- [ ] Admin guide complete.
- [ ] User guide complete.
- [ ] API documentation published.
- [ ] Release notes and known limitations published.

## Customer Onboarding Readiness
- [ ] Pilot qualification checklist approved.
- [ ] Training material ready.
- [ ] Data import process verified.
- [ ] Role setup checklist ready.
- [ ] Support contacts and hours communicated.

## Monitoring Readiness
- [ ] Application logs centralized.
- [ ] Error tracking configured.
- [ ] Health checks monitored.
- [ ] Alerts configured for API, database, storage, email, and background jobs.
- [ ] On-call or response owner assigned.

## Backup / Rollback Readiness
- [ ] Database backup policy enabled.
- [ ] Restore rehearsal completed.
- [ ] RPO/RTO evidence recorded.
- [ ] File storage backup/retention verified.
- [ ] Rollback procedure tested.

## Final Gate
- [ ] Product signoff.
- [ ] QA signoff.
- [ ] Security signoff.
- [ ] Backend signoff.
- [ ] Frontend signoff.
- [ ] DevOps signoff.
- [ ] Support signoff.
- [ ] Business signoff.
