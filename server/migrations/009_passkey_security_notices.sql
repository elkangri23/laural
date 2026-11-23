ALTER TABLE account_security_email_outbox
  DROP CONSTRAINT account_security_email_outbox_event_type_check;

ALTER TABLE account_security_email_outbox
  ADD CONSTRAINT account_security_email_outbox_event_type_check
  CHECK (event_type IN (
    'totp_enabled',
    'recovery_codes_rotated',
    'totp_disabled',
    'passkey_added',
    'passkey_removed'
  ));
