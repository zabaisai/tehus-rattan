import * as fs from 'fs';
import * as path from 'path';

// Structural guarantee, not just a runtime one: reads the actual schema and
// the migration that created these tables, and asserts neither ever
// declares a full-IP-address column. If someone reintroduces `ipAddress`
// (or any other unbounded IP field) on UserSession/LoginEvent, this test
// fails at the source-of-truth level, independent of anything the service
// layer does or doesn't select.
describe('UserSession/LoginEvent schema privacy', () => {
  const schemaPath = path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');
  const migrationPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'migrations',
    '20260715151453_add_session_activity_monitoring',
    'migration.sql',
  );

  const schema = fs.readFileSync(schemaPath, 'utf8');
  const migration = fs.readFileSync(migrationPath, 'utf8');

  function extractModelBlock(source: string, modelName: string): string {
    const match = source.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`model ${modelName} not found in schema`);
    return match[0];
  }

  it('UserSession has no full-IP column — only the already-truncated ipPreview', () => {
    const block = extractModelBlock(schema, 'UserSession');
    expect(block).not.toMatch(/\bipAddress\b/);
    expect(block).toMatch(/\bipPreview\s+String\?/);
  });

  it('LoginEvent has no full-IP column — only the already-truncated ipPreview', () => {
    const block = extractModelBlock(schema, 'LoginEvent');
    expect(block).not.toMatch(/\bipAddress\b/);
    expect(block).toMatch(/\bipPreview\s+String\?/);
  });

  it('UserSession stores deviceIdHash, never a raw deviceId column', () => {
    const block = extractModelBlock(schema, 'UserSession');
    expect(block).toMatch(/\bdeviceIdHash\s+String\b/);
    expect(block).not.toMatch(/\bdeviceId\s+String\b/);
  });

  it('neither UserSession nor LoginEvent stores a raw userAgent column', () => {
    expect(extractModelBlock(schema, 'UserSession')).not.toMatch(/\buserAgent\b/);
    expect(extractModelBlock(schema, 'LoginEvent')).not.toMatch(/\buserAgent\b/);
  });

  it('the migration that created these tables never creates an ipAddress or raw deviceId/userAgent column', () => {
    expect(migration).not.toMatch(/"ipAddress"/);
    expect(migration).not.toMatch(/"userAgent"/);
    expect(migration).not.toMatch(/"deviceId"\s/); // deviceIdHash contains "deviceId" as a substring — require the exact quoted column name
    expect(migration).toMatch(/"deviceIdHash"/);
    expect(migration).toMatch(/"ipPreview"/);
  });

  it('the unique device constraint is on (userId, deviceIdHash), never a raw deviceId', () => {
    expect(migration).toMatch(/"user_sessions_userId_deviceIdHash_key"/);
  });
});
