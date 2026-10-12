# SES (sandbox — accepted for staging): the sender identity is created only
# when email_from_address is set; SES then e-mails that address a
# verification link. In the sandbox every recipient must be verified too
# (one identity per test mailbox, created the same way or in the console).
# No domain identity: verifying octapm.com needs DNS records, which wait for
# the production domain phase.

resource "aws_sesv2_configuration_set" "staging" {
  configuration_set_name = var.name
  sending_options {
    sending_enabled = true
  }
  tags = {
    Component = "email"
  }
}

resource "aws_sesv2_email_identity" "sender" {
  count                  = var.email_from_address == "" ? 0 : 1
  email_identity         = var.email_from_address
  configuration_set_name = aws_sesv2_configuration_set.staging.configuration_set_name
  tags = {
    Component = "email"
  }
}
