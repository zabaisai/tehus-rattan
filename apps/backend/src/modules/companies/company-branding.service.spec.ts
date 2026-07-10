import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
import {
  CompanyBrandingService,
  detectImageExtension,
  UploadedLogoFile,
} from './company-branding.service';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_BUFFER = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
const SVG_BUFFER = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
);

function fakeFile(overrides: Partial<UploadedLogoFile> = {}): UploadedLogoFile {
  return {
    buffer: PNG_BUFFER,
    originalname: 'logo.png',
    mimetype: 'image/png',
    size: PNG_BUFFER.length,
    ...overrides,
  };
}

describe('detectImageExtension', () => {
  it('detects a real PNG by magic bytes', () => {
    expect(detectImageExtension(PNG_BUFFER)).toBe('png');
  });

  it('detects a real JPEG by magic bytes', () => {
    expect(detectImageExtension(JPEG_BUFFER)).toBe('jpg');
  });

  it('detects a real WEBP by magic bytes', () => {
    expect(detectImageExtension(WEBP_BUFFER)).toBe('webp');
  });

  it('returns null for SVG content', () => {
    expect(detectImageExtension(SVG_BUFFER)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectImageExtension(Buffer.alloc(0))).toBeNull();
  });
});

describe('CompanyBrandingService', () => {
  let prisma: any;
  let service: CompanyBrandingService;
  const mkdirMock = fs.mkdirSync as jest.Mock;
  const writeFileMock = fs.writeFileSync as jest.Mock;

  beforeEach(() => {
    mkdirMock.mockClear();
    writeFileMock.mockClear();
    prisma = {
      company: {
        update: jest.fn((args: any) =>
          Promise.resolve({
            id: args.where.id,
            logoUrl: null,
            secondaryLogoUrl: null,
            ...args.data,
          }),
        ),
      },
    };
    service = new CompanyBrandingService(prisma);
  });

  it('rejects when no file is provided', async () => {
    await expect(service.uploadLogo('company-a', undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  describe('assertValidLogoFile (reused by onboarding, no DB/disk access)', () => {
    it('returns the detected extension for a valid PNG', () => {
      expect(service.assertValidLogoFile(fakeFile())).toBe('png');
    });

    it('returns the detected extension for a valid JPEG', () => {
      const file = fakeFile({
        buffer: JPEG_BUFFER,
        originalname: 'logo.jpg',
        mimetype: 'image/jpeg',
        size: JPEG_BUFFER.length,
      });
      expect(service.assertValidLogoFile(file)).toBe('jpg');
    });

    it('returns the detected extension for a valid WEBP', () => {
      const file = fakeFile({
        buffer: WEBP_BUFFER,
        originalname: 'logo.webp',
        mimetype: 'image/webp',
        size: WEBP_BUFFER.length,
      });
      expect(service.assertValidLogoFile(file)).toBe('webp');
    });

    it('throws on a real SVG', () => {
      const file = fakeFile({
        buffer: SVG_BUFFER,
        originalname: 'logo.svg',
        mimetype: 'image/svg+xml',
        size: SVG_BUFFER.length,
      });
      expect(() => service.assertValidLogoFile(file)).toThrow(BadRequestException);
    });

    it('throws on a spoofed PNG (SVG bytes, .png extension)', () => {
      const file = fakeFile({
        buffer: SVG_BUFFER,
        originalname: 'logo.png',
        mimetype: 'image/png',
        size: SVG_BUFFER.length,
      });
      expect(() => service.assertValidLogoFile(file)).toThrow(BadRequestException);
    });

    it('throws when no file is provided', () => {
      expect(() => service.assertValidLogoFile(undefined)).toThrow(BadRequestException);
    });
  });

  it('rejects an SVG file outright (extension not allowed)', async () => {
    const file = fakeFile({
      buffer: SVG_BUFFER,
      originalname: 'logo.svg',
      mimetype: 'image/svg+xml',
      size: SVG_BUFFER.length,
    });

    await expect(service.uploadLogo('company-a', file)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('rejects a file with a spoofed extension (real content is not an image)', async () => {
    // Claims to be a PNG (right extension, right mimetype) but the actual
    // bytes are not — this is exactly what extension/mimetype checks alone
    // cannot catch, and what magic-byte detection exists to stop.
    const file = fakeFile({
      buffer: SVG_BUFFER,
      originalname: 'logo.png',
      mimetype: 'image/png',
      size: SVG_BUFFER.length,
    });

    await expect(service.uploadLogo('company-a', file)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('rejects a file over the 2MB size limit', async () => {
    const file = fakeFile({ size: 3 * 1024 * 1024 });

    await expect(service.uploadLogo('company-a', file)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('accepts a valid PNG and updates logoUrl by default', async () => {
    const result = await service.uploadLogo('company-a', fakeFile());

    expect(writeFileMock).toHaveBeenCalled();
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-a' },
        data: { logoUrl: expect.stringMatching(/^\/uploads\/branding\/company-a\/.+\.png$/) },
      }),
    );
    expect(result.message).toBe('Logo actualizado correctamente');
    expect(result.companyId).toBe('company-a');
  });

  it('accepts a valid JPEG', async () => {
    const file = fakeFile({
      buffer: JPEG_BUFFER,
      originalname: 'logo.jpg',
      mimetype: 'image/jpeg',
      size: JPEG_BUFFER.length,
    });

    await service.uploadLogo('company-a', file);

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { logoUrl: expect.stringMatching(/\.jpg$/) },
      }),
    );
  });

  it('accepts a valid WEBP', async () => {
    const file = fakeFile({
      buffer: WEBP_BUFFER,
      originalname: 'logo.webp',
      mimetype: 'image/webp',
      size: WEBP_BUFFER.length,
    });

    await service.uploadLogo('company-a', file);

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { logoUrl: expect.stringMatching(/\.webp$/) },
      }),
    );
  });

  it('updates secondaryLogoUrl instead of logoUrl when type is "secondary"', async () => {
    await service.uploadLogo('company-a', fakeFile(), 'secondary');

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { secondaryLogoUrl: expect.stringMatching(/^\/uploads\/branding\/company-a\//) },
      }),
    );
  });

  it('never targets a different company than the one passed in', async () => {
    await service.uploadLogo('company-b', fakeFile());

    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-b' } }),
    );
    expect(prisma.company.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'company-a' } }),
    );
  });
});
