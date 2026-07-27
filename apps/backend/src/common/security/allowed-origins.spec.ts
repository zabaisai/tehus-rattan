import { buildAllowedOrigins } from './allowed-origins';

describe('buildAllowedOrigins', () => {
  it('includes FRONTEND_URL and localhost in non-production', () => {
    const list = buildAllowedOrigins({
      FRONTEND_URL: 'https://crm.example.com',
      NODE_ENV: 'development',
    });
    expect(list).toContain('https://crm.example.com');
    expect(list).toContain('http://localhost:3000');
  });

  it('excludes localhost in production', () => {
    const list = buildAllowedOrigins({
      FRONTEND_URL: 'https://crm.example.com',
      NODE_ENV: 'production',
    });
    expect(list).toContain('https://crm.example.com');
    expect(list).not.toContain('http://localhost:3000');
  });

  it('parses a comma-separated CSRF_ALLOWED_ORIGINS and trims blanks', () => {
    const list = buildAllowedOrigins({
      CSRF_ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com ,',
      NODE_ENV: 'production',
    });
    expect(list).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('is empty (fail-closed) in production with nothing configured', () => {
    expect(buildAllowedOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });
});
