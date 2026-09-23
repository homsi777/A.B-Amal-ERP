-- سجل تدقيق لإجراءات مدير المنصة عبر الحسابات (تبديل حساب، إنشاء حساب،
-- إنشاء مستخدم بحساب آخر) — منفصل عن audit_logs لأنه يوثّق انتقالاً بين
-- حسابين (from/to) وليس حدثاً داخل حساب واحد.
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  action          text NOT NULL,
  from_company_id uuid NULL REFERENCES companies(id),
  to_company_id   uuid NULL REFERENCES companies(id),
  ip              text NULL,
  user_agent      text NULL,
  details         jsonb NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_platform_audit_log_actor_created
  ON platform_audit_log (actor_user_id, created_at DESC);

-- يسمح بتسجيل حدث "تفعيل تلقائي عند إنشاء حساب من مدير المنصة" في نفس جدول
-- activation_events (بدل اختراع جدول موازٍ)، بنفس أسلوب التمديد المستخدم
-- سابقاً في 010_cloud_license_authority_hardening.sql.
ALTER TABLE activation_events
  DROP CONSTRAINT IF EXISTS chk_activation_events_type;

ALTER TABLE activation_events
  ADD CONSTRAINT chk_activation_events_type
  CHECK (
    event_type IN (
      'KEY_GENERATED',
      'ACTIVATION_SUCCESS',
      'ACTIVATION_FAILED',
      'DUPLICATE_ATTEMPT',
      'REVOKED_ATTEMPT',
      'EXPIRED_ATTEMPT',
      'KEY_REVOKED',
      'STATUS_CHECK',
      'PLATFORM_PROVISIONED'
    )
  );
