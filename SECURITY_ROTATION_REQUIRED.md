# Security Rotation Required

The audit reported runtime environment files in a release/upload archive. No secret
values are recorded here. Treat any value that was present in those files at the
time of archive creation as exposed outside the trusted runtime boundary.

| Path | Secret category | Risk | Rotation instruction |
| --- | --- | --- | --- |
| `backend/.env` | Backend runtime secrets such as database URL, JWT secrets, AI provider keys, S3 credentials, Stripe secrets, CloudFront origin secret | High | Rotate every non-placeholder backend runtime secret in the deployment secret store, revoke old provider keys, refresh JWT/refresh-token signing secrets, and restart deployed services after updating the managed environment. |
| `frontend/.env` | Frontend build-time environment values | Medium | Verify no private keys were placed in Vite variables. Move private values to backend/runtime secret storage and rotate any exposed service token. |
| `frontend/.env.production` | Frontend production build-time environment values | Medium | Keep the file untracked. Verify values are public client-safe configuration only, and rotate any token or private endpoint credential if one was ever present. |
