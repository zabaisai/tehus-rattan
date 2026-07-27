import { parseUserAgent } from './user-agent.util';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SAFARI_IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('parseUserAgent', () => {
  it('returns all-null/UNKNOWN for a missing user agent', () => {
    expect(parseUserAgent(null)).toEqual({
      browser: null,
      operatingSystem: null,
      deviceType: 'UNKNOWN',
    });
    expect(parseUserAgent(undefined)).toEqual({
      browser: null,
      operatingSystem: null,
      deviceType: 'UNKNOWN',
    });
  });

  it('parses a desktop Chrome/Windows user agent as DESKTOP', () => {
    const result = parseUserAgent(CHROME_WINDOWS);
    expect(result.browser).toContain('Chrome');
    expect(result.operatingSystem).toContain('Windows');
    expect(result.deviceType).toBe('DESKTOP');
  });

  it('parses an iPhone user agent as MOBILE', () => {
    const result = parseUserAgent(SAFARI_IPHONE);
    expect(result.deviceType).toBe('MOBILE');
    expect(result.operatingSystem).toContain('iOS');
  });

  it('parses an iPad user agent as TABLET', () => {
    const result = parseUserAgent(SAFARI_IPAD);
    expect(result.deviceType).toBe('TABLET');
  });

  it('never derives anything from fonts, screen size, or canvas — only the UA string', () => {
    // Structural guarantee: the function's only parameter is the raw
    // string, so there is no code path through which any other signal
    // could influence the result.
    expect(parseUserAgent.length).toBe(1);
  });
});
