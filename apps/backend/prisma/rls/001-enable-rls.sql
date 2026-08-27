-- RLS para TAKTO — generado a partir de schema.prisma (tablas con companyId NOT NULL).
-- IDEMPOTENTE. NO se aplica automáticamente (no está en prisma/migrations): activarlo
-- exige antes el rol runtime separado y que la app fije app.company_id por transacción
-- (ver src/prisma/tenant-context.ts y prisma/rls/README.md). Sin ese contexto, con RLS
-- activo toda consulta devuelve 0 filas (fail-closed), que es justo lo que NO se quiere en
-- caliente hasta haber adoptado el contexto. current_setting(...,true) devuelve NULL si no
-- está fijado, y "companyId = NULL" es NULL ⇒ deny-by-default.

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contacts";
CREATE POLICY tenant_isolation ON "contacts"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "contact_merges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_merges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contact_merges";
CREATE POLICY tenant_isolation ON "contact_merges"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "contact_merge_dismissals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_merge_dismissals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "contact_merge_dismissals";
CREATE POLICY tenant_isolation ON "contact_merge_dismissals"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "conversations";
CREATE POLICY tenant_isolation ON "conversations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automations";
CREATE POLICY tenant_isolation ON "automations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "automation_runs";
CREATE POLICY tenant_isolation ON "automation_runs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "pipelines";
CREATE POLICY tenant_isolation ON "pipelines"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "leads";
CREATE POLICY tenant_isolation ON "leads"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tasks";
CREATE POLICY tenant_isolation ON "tasks"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "task_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_suggestions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "task_suggestions";
CREATE POLICY tenant_isolation ON "task_suggestions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notes";
CREATE POLICY tenant_isolation ON "notes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "product_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_imports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "product_imports";
CREATE POLICY tenant_isolation ON "product_imports"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "products";
CREATE POLICY tenant_isolation ON "products"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "quotes";
CREATE POLICY tenant_isolation ON "quotes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "whatsapp_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_integrations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_integrations";
CREATE POLICY tenant_isolation ON "whatsapp_integrations"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "whatsapp_embedded_signup_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_embedded_signup_states" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_embedded_signup_states";
CREATE POLICY tenant_isolation ON "whatsapp_embedded_signup_states"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notifications";
CREATE POLICY tenant_isolation ON "notifications"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "notification_preferences";
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "support_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "support_sessions";
CREATE POLICY tenant_isolation ON "support_sessions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outbox_events";
CREATE POLICY tenant_isolation ON "outbox_events"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "chatbot_flows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chatbot_flows" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "chatbot_flows";
CREATE POLICY tenant_isolation ON "chatbot_flows"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "chatbot_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chatbot_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "chatbot_sessions";
CREATE POLICY tenant_isolation ON "chatbot_sessions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "data_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_requests";
CREATE POLICY tenant_isolation ON "data_requests"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbots";
CREATE POLICY tenant_isolation ON "flowbots"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_executions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_executions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_executions";
CREATE POLICY tenant_isolation ON "flowbot_executions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_waits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_waits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_waits";
CREATE POLICY tenant_isolation ON "flowbot_waits"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_metrics" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_metrics";
CREATE POLICY tenant_isolation ON "flowbot_metrics"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_test_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_test_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_test_runs";
CREATE POLICY tenant_isolation ON "flowbot_test_runs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "company_lead_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_lead_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "company_lead_settings";
CREATE POLICY tenant_isolation ON "company_lead_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "custom_field_definitions";
CREATE POLICY tenant_isolation ON "custom_field_definitions"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "custom_field_values";
CREATE POLICY tenant_isolation ON "custom_field_values"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "custom_field_value_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_value_changes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "custom_field_value_changes";
CREATE POLICY tenant_isolation ON "custom_field_value_changes"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "conversation_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversation_handoffs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "conversation_handoffs";
CREATE POLICY tenant_isolation ON "conversation_handoffs"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_credentials";
CREATE POLICY tenant_isolation ON "flowbot_credentials"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_settings";
CREATE POLICY tenant_isolation ON "flowbot_settings"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "flowbot_ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "flowbot_ai_usage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "flowbot_ai_usage";
CREATE POLICY tenant_isolation ON "flowbot_ai_usage"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "whatsapp_templates";
CREATE POLICY tenant_isolation ON "whatsapp_templates"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));

