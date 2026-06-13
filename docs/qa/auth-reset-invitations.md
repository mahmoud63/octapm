# Password Reset And Invitation QA

## Admin Onboarding

- A Project Manager opens Users, selects Invite User, enters an email, role, optional project access, and optional message.
- The backend stores only a hashed invitation token, revokes older pending invitations for the same organization/email, audits the invite, and sends an email through the configured email provider.
- The recipient opens `/accept-invite?token=...`, reviews organization/project/role details, sets a password when required, and accepts.
- Acceptance creates a new organization user or links an existing user from the same organization. If a project was selected, a `ProjectAssignment` is created or updated with the invited role.
- Emails already registered to another organization are rejected to avoid cross-tenant account linking.

## Account Recovery

- A user opens Forgot Password and submits their email.
- The response is always neutral. If the email belongs to an active account, the backend stores a one-time hashed reset token and sends `/reset-password?token=...`.
- Reset token use updates the password, marks the token used, revokes other pending reset tokens, and revokes active refresh sessions.
- Expired, reused, revoked, or unknown tokens return `PASSWORD_RESET_TOKEN_INVALID`.

## Manual QA Checklist

- Verify reset and invitation emails are delivered through `EMAIL_WEBHOOK_URL` or the production notification provider.
- Verify production fails closed when no email provider is configured.
- Verify reset links expire according to `PASSWORD_RESET_TOKEN_MINUTES`.
- Verify invitation links expire according to `INVITATION_TOKEN_DAYS`.
- Verify accepting an invitation twice fails.
- Verify a non-PM cannot call `POST /api/v1/users/invitations`.
- Verify project-scoped invitations create the correct project assignment.
- Verify password reset and invitation events appear in `AuthAuditEvent`; project-scoped invites also write project audit history.
