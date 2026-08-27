import { describe, expect, it } from 'vitest';
import { isSafeHttpUrl, isSafeInternalPath, safeInternalPath } from './safe-url';

describe('isSafeInternalPath', () => {
  it('accepts absolute app paths', () => {
    expect(isSafeInternalPath('/dashboard')).toBe(true);
    expect(isSafeInternalPath('/dashboard/contacts?f=1#top')).toBe(true);
  });

  it('rejects protocol-relative and backslash-escaped URLs', () => {
    expect(isSafeInternalPath('//evil.com/phish')).toBe(false);
    expect(isSafeInternalPath('/\\evil.com')).toBe(false);
  });

  it('rejects full URLs and dangerous schemes', () => {
    expect(isSafeInternalPath('https://evil.com')).toBe(false);
    expect(isSafeInternalPath('javascript:alert(1)')).toBe(false);
    expect(isSafeInternalPath('data:text/html,x')).toBe(false);
  });

  it('rejects empty and nullish values', () => {
    expect(isSafeInternalPath('')).toBe(false);
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
  });
});

describe('safeInternalPath', () => {
  it('returns the value when safe, the fallback otherwise', () => {
    expect(safeInternalPath('/dashboard/tasks', '/dashboard')).toBe('/dashboard/tasks');
    expect(safeInternalPath('//evil.com', '/dashboard')).toBe('/dashboard');
    expect(safeInternalPath(null, '/dashboard')).toBe('/dashboard');
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts http(s) URLs only', () => {
    expect(isSafeHttpUrl('https://cdn.example.com/img.jpg')).toBe(true);
    expect(isSafeHttpUrl('http://localhost:3001/x.png')).toBe(true);
  });

  it('rejects javascript:, data:, blob: and malformed values', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
    expect(isSafeHttpUrl('blob:https://x')).toBe(false);
    expect(isSafeHttpUrl('//evil.com/img.jpg')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});
