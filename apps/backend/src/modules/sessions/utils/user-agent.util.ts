import { UAParser } from 'ua-parser-js';
import { DeviceType } from '@prisma/client';

export interface ParsedUserAgent {
  browser: string | null;
  operatingSystem: string | null;
  deviceType: DeviceType;
}

// Derives only a coarse browser/OS/device-type summary from the standard
// User-Agent header — no canvas, fonts, screen resolution, or other
// invasive fingerprinting signals. This alone is not how devices are told
// apart (see device-id.middleware.ts for the actual identity); it only
// makes the recognized-device list readable in the panel.
export function parseUserAgent(
  rawUserAgent: string | null | undefined,
): ParsedUserAgent {
  if (!rawUserAgent) {
    return {
      browser: null,
      operatingSystem: null,
      deviceType: DeviceType.UNKNOWN,
    };
  }

  const result = new UAParser(rawUserAgent).getResult();

  const browser = result.browser.name
    ? [result.browser.name, result.browser.major].filter(Boolean).join(' ')
    : null;
  const operatingSystem = result.os.name
    ? [result.os.name, result.os.version].filter(Boolean).join(' ')
    : null;

  let deviceType: DeviceType = DeviceType.DESKTOP;
  if (result.device.type === 'mobile') deviceType = DeviceType.MOBILE;
  else if (result.device.type === 'tablet') deviceType = DeviceType.TABLET;
  else if (!browser && !operatingSystem) deviceType = DeviceType.UNKNOWN;

  return { browser, operatingSystem, deviceType };
}
