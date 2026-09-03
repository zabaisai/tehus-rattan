-- Phase 0 read-only inventory for a TAKTO staging database.
--
-- Usage (from the VPS, never from a workstation with a copied .env):
--   docker compose -f docker-compose.staging.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v target_company_id='<Company.id under review>' \
--     -f - < docs/phase-0/staging-inventory.sql
--
-- Properties:
--   * Runs entirely inside BEGIN TRANSACTION READ ONLY ... ROLLBACK.
--   * Never prints emails, phones, invitation codes, tokens or message bodies.
--   * Companies are referenced by an anonymous ordinal (company_ref), never by
--     name or id. The only id involved is the psql variable target_company_id,
--     which must be supplied on the command line and must not be committed.
--   * Section 9 (target company detail) prints Company.settings and colours;
--     keep that section's output in private evidence outside Git.
--
-- Column names follow the Prisma schema (camelCase, no @map on fields), so
-- they must be double-quoted.

\set ON_ERROR_STOP on
\pset footer off
\pset null '(null)'

BEGIN TRANSACTION READ ONLY;

\echo '=== 0. server / db context'
SELECT current_database() AS db, current_user AS usr, now() AT TIME ZONE 'UTC' AS now_utc,
       (SELECT count(*) FROM _prisma_migrations) AS migrations_applied,
       (SELECT max(finished_at) FROM _prisma_migrations) AS last_migration_finished_at;

\echo '=== 1. companies'
SELECT count(*) AS companies_total,
       count(*) FILTER (WHERE status = 'ACTIVE')    AS active,
       count(*) FILTER (WHERE status = 'SUSPENDED') AS suspended,
       count(*) FILTER (WHERE status = 'DELETED')   AS deleted,
       count(*) FILTER (WHERE "isDemo")             AS demo,
       count(*) FILTER (WHERE slug IS NULL)         AS without_slug,
       count(*) FILTER (WHERE settings IS NULL)     AS without_settings,
       count(*) FILTER (WHERE "businessType" IS NULL) AS without_business_type,
       count(*) FILTER (WHERE "logoUrl" IS NULL)    AS without_logo,
       count(*) FILTER (WHERE "primaryColor" IS NULL) AS without_primary_color
FROM companies;

\echo '=== 2. users'
SELECT count(*) AS users_total,
       count(*) FILTER (WHERE "isActive")     AS active,
       count(*) FILTER (WHERE NOT "isActive") AS inactive,
       count(*) FILTER (WHERE "companyId" IS NULL) AS without_company
FROM users;
SELECT role, count(*) FROM users GROUP BY role ORDER BY role;

\echo '=== 3. per-company aggregate (anonymous ordinal by creation order)'
WITH c AS (
  SELECT id, status, "isDemo", slug, settings, "businessType",
         row_number() OVER (ORDER BY "createdAt", id) AS n
  FROM companies
)
SELECT 'company_' || c.n AS company_ref,
       c.status,
       c."isDemo"                       AS is_demo,
       c.slug IS NOT NULL               AS has_slug,
       c.settings IS NOT NULL           AS has_settings,
       c."businessType" IS NOT NULL     AS has_business_type,
       (SELECT count(*) FROM users u WHERE u."companyId" = c.id)                            AS users,
       (SELECT count(*) FROM users u WHERE u."companyId" = c.id AND u."isActive")           AS users_active,
       (SELECT count(*) FROM pipelines p WHERE p."companyId" = c.id)                        AS pipelines,
       (SELECT count(*) FROM pipeline_stages s JOIN pipelines p ON p.id = s."pipelineId" WHERE p."companyId" = c.id) AS stages,
       (SELECT count(*) FROM products pr WHERE pr."companyId" = c.id)                       AS products,
       (SELECT count(DISTINCT pr.category) FROM products pr WHERE pr."companyId" = c.id AND pr.category IS NOT NULL) AS product_categories,
       COALESCE(jsonb_array_length(NULLIF(c.settings::jsonb -> 'categories', 'null'::jsonb)), 0) AS settings_categories,
       (SELECT count(*) FROM contacts ct WHERE ct."companyId" = c.id)                       AS contacts,
       (SELECT count(*) FROM leads l WHERE l."companyId" = c.id)                            AS leads,
       (SELECT count(*) FROM leads l WHERE l."companyId" = c.id AND l.status = 'OPEN')      AS leads_open,
       (SELECT count(*) FROM conversations cv WHERE cv."companyId" = c.id)                  AS conversations,
       (SELECT count(*) FROM tasks t WHERE t."companyId" = c.id)                            AS tasks,
       (SELECT count(*) FROM quotes q WHERE q."companyId" = c.id)                           AS quotes,
       (SELECT count(*) FROM whatsapp_integrations w WHERE w."companyId" = c.id)            AS wa_integrations,
       (SELECT count(*) FROM company_lead_settings ls WHERE ls."companyId" = c.id)          AS lead_settings_rows,
       (SELECT count(*) FROM custom_field_definitions d WHERE d."companyId" = c.id)         AS custom_fields,
       (SELECT count(*) FROM flowbots f WHERE f."companyId" = c.id)                         AS flowbots,
       (SELECT count(*) FROM invitation_codes ic WHERE ic."companyId" = c.id)               AS invitation_codes_linked
FROM c
ORDER BY c.n;

\echo '=== 4. pipelines and stages per company'
WITH c AS (SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n FROM companies)
SELECT 'company_' || c.n AS company_ref,
       p."order" AS pipeline_order, p."isDefault", p."isArchived",
       count(s.id) AS stages,
       count(s.id) FILTER (WHERE s."isInitial") AS initial_stages,
       count(s.id) FILTER (WHERE s.type = 'WON')  AS won_stages,
       count(s.id) FILTER (WHERE s.type = 'LOST') AS lost_stages,
       string_agg(s.name, ' > ' ORDER BY s."order") AS stage_names
FROM c
JOIN pipelines p ON p."companyId" = c.id
LEFT JOIN pipeline_stages s ON s."pipelineId" = p.id
GROUP BY c.n, p.id, p."order", p."isDefault", p."isArchived"
ORDER BY c.n, p."order";

\echo '=== 5. categories: DB values vs hardcoded furniture list'
WITH furniture(name) AS (
  VALUES ('Salas'),('Comedores'),('Sillas'),('Lámparas'),('Accesorios'),
         ('Columpios'),('Asoleadoras'),('Zonas húmedas'),('Proyectos personalizados')
),
c AS (SELECT id, settings, row_number() OVER (ORDER BY "createdAt", id) AS n FROM companies),
settings_cats AS (
  SELECT c.n, v.value AS category
  FROM c, jsonb_array_elements_text(COALESCE(NULLIF(c.settings::jsonb -> 'categories', 'null'::jsonb), '[]'::jsonb)) v
),
product_cats AS (
  SELECT c.n, pr.category FROM c JOIN products pr ON pr."companyId" = c.id WHERE pr.category IS NOT NULL
)
SELECT 'company_' || c.n AS company_ref,
       (SELECT count(*) FROM settings_cats s WHERE s.n = c.n) AS settings_categories,
       (SELECT count(*) FROM settings_cats s WHERE s.n = c.n AND s.category IN (SELECT name FROM furniture)) AS settings_categories_in_furniture_list,
       (SELECT count(DISTINCT category) FROM product_cats p WHERE p.n = c.n) AS product_categories,
       (SELECT count(DISTINCT category) FROM product_cats p WHERE p.n = c.n AND p.category IN (SELECT name FROM furniture)) AS product_categories_in_furniture_list
FROM c ORDER BY c.n;

\echo '=== 6. global totals'
SELECT (SELECT count(*) FROM contacts)       AS contacts,
       (SELECT count(*) FROM contacts WHERE "mergedIntoId" IS NOT NULL) AS contacts_merged,
       (SELECT count(*) FROM contacts WHERE "archivedAt" IS NOT NULL)   AS contacts_archived,
       (SELECT count(*) FROM leads)          AS leads,
       (SELECT count(*) FROM conversations)  AS conversations,
       (SELECT count(*) FROM messages)       AS messages,
       (SELECT count(*) FROM tasks)          AS tasks,
       (SELECT count(*) FROM quotes)         AS quotes,
       (SELECT count(*) FROM products)       AS products,
       (SELECT count(*) FROM pipelines)      AS pipelines,
       (SELECT count(*) FROM pipeline_stages) AS pipeline_stages,
       (SELECT count(*) FROM audit_logs)     AS audit_logs,
       (SELECT count(*) FROM user_sessions)  AS user_sessions,
       (SELECT count(*) FROM flowbots)       AS flowbots,
       (SELECT count(*) FROM whatsapp_integrations) AS wa_integrations;
SELECT status, count(*) FROM leads GROUP BY status ORDER BY status;
SELECT status, count(*) FROM tasks GROUP BY status ORDER BY status;
SELECT status, count(*) FROM conversations GROUP BY status ORDER BY status;

\echo '=== 7. invitation codes by status (no code, no preview, no email)'
SELECT status, count(*) AS codes,
       count(*) FILTER (WHERE "expiresAt" IS NOT NULL AND "expiresAt" < now()) AS expired_by_date,
       count(*) FILTER (WHERE "companyId" IS NOT NULL) AS linked_to_company
FROM invitation_codes GROUP BY status ORDER BY status;

\echo '=== 8. multi-tenant isolation checks (every row should be 0)'
SELECT 'leads.company <> pipeline.company'  AS check, count(*) FROM leads l JOIN pipelines p ON p.id = l."pipelineId" WHERE p."companyId" <> l."companyId"
UNION ALL SELECT 'leads.company <> stage.pipeline.company', count(*) FROM leads l JOIN pipeline_stages s ON s.id = l."stageId" JOIN pipelines p ON p.id = s."pipelineId" WHERE p."companyId" <> l."companyId"
UNION ALL SELECT 'leads.company <> contact.company', count(*) FROM leads l JOIN contacts c ON c.id = l."contactId" WHERE c."companyId" <> l."companyId"
UNION ALL SELECT 'leads.assignee in other company', count(*) FROM leads l JOIN users u ON u.id = l."assignedTo" WHERE u."companyId" IS DISTINCT FROM l."companyId"
UNION ALL SELECT 'conversations.company <> contact.company', count(*) FROM conversations cv JOIN contacts c ON c.id = cv."contactId" WHERE c."companyId" <> cv."companyId"
UNION ALL SELECT 'conversations.assignee in other company', count(*) FROM conversations cv JOIN users u ON u.id = cv."assignedTo" WHERE u."companyId" IS DISTINCT FROM cv."companyId"
UNION ALL SELECT 'tasks.company <> lead.company', count(*) FROM tasks t JOIN leads l ON l.id = t."leadId" WHERE l."companyId" <> t."companyId"
UNION ALL SELECT 'quotes.company <> lead.company', count(*) FROM quotes q JOIN leads l ON l.id = q."leadId" WHERE l."companyId" <> q."companyId"
UNION ALL SELECT 'quote_items.product in other company', count(*) FROM quote_items qi JOIN quotes q ON q.id = qi."quoteId" JOIN products pr ON pr.id = qi."productId" WHERE pr."companyId" <> q."companyId"
UNION ALL SELECT 'lead_products.product in other company', count(*) FROM lead_products lp JOIN leads l ON l.id = lp."leadId" JOIN products pr ON pr.id = lp."productId" WHERE pr."companyId" <> l."companyId"
UNION ALL SELECT 'lead_settings.pipeline in other company', count(*) FROM company_lead_settings ls JOIN pipelines p ON p.id = ls."defaultPipelineId" WHERE p."companyId" <> ls."companyId"
UNION ALL SELECT 'users with role<>SUPER_ADMIN and no company', count(*) FROM users WHERE "companyId" IS NULL AND role <> 'SUPER_ADMIN'
UNION ALL SELECT 'users SUPER_ADMIN with a company', count(*) FROM users WHERE "companyId" IS NOT NULL AND role = 'SUPER_ADMIN'
UNION ALL SELECT 'companies without any pipeline', count(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p."companyId" = c.id)
UNION ALL SELECT 'companies with >1 default pipeline', count(*) FROM (SELECT "companyId" FROM pipelines WHERE "isDefault" GROUP BY 1 HAVING count(*) > 1) x
UNION ALL SELECT 'companies without users', count(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u."companyId" = c.id);

\echo '=== 9. target company detail (PRIVATE OUTPUT - keep outside Git)'
SELECT slug IS NOT NULL AS has_slug, slug, status, "isDemo", "businessType", city, country,
       timezone, currency, locale, "quoteRoundingDecimals", "defaultTaxRate", "taxIncluded",
       "autoAssignEnabled", "responseSlaMinutes", "retentionMonths", "retentionPurgeEnabled",
       "primaryColor", "accentColor", "backgroundColor",
       "logoUrl" IS NOT NULL AS has_logo, "secondaryLogoUrl" IS NOT NULL AS has_secondary_logo,
       "legalName" IS NOT NULL AS has_legal_name, "taxId" IS NOT NULL AS has_tax_id,
       "quoteFooter" IS NOT NULL AS has_quote_footer, "businessHours" IS NOT NULL AS has_business_hours,
       "createdAt", "updatedAt"
FROM companies WHERE id = :'target_company_id';
SELECT jsonb_pretty(settings::jsonb) AS settings FROM companies WHERE id = :'target_company_id';
SELECT "autoCreateLead", "reuseOpenLead", "createInitialTask", "assignmentStrategy", "reactivateArchived",
       "requireTaskApproval", "defaultPipelineId" IS NOT NULL AS has_default_pipeline,
       "initialStageId" IS NOT NULL AS has_initial_stage, "quotePipelineId" IS NOT NULL AS has_quote_pipeline
FROM company_lead_settings WHERE "companyId" = :'target_company_id';
SELECT status, "connectionMethod", "isPrimary", "connectedAt" IS NOT NULL AS ever_connected, "lastErrorCode"
FROM whatsapp_integrations WHERE "companyId" = :'target_company_id';
SELECT entity, key, type, "isActive", "isRequired" FROM custom_field_definitions WHERE "companyId" = :'target_company_id' ORDER BY entity, "order";
SELECT p.name AS pipeline, p."isDefault", s."order", s.name AS stage, s.type, s."isInitial", s.probability, s.color
FROM pipelines p JOIN pipeline_stages s ON s."pipelineId" = p.id
WHERE p."companyId" = :'target_company_id' ORDER BY p."order", s."order";

ROLLBACK;
