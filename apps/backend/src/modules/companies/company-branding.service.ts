import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

export type LogoType = 'primary' | 'secondary';

export interface UploadedLogoFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// The only source of truth for what a file actually is — extension and
// mimetype above are both attacker-controlled and only used as a cheap,
// early rejection, never to decide what gets written to disk.
export function detectImageExtension(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }

  return null;
}

@Injectable()
export class CompanyBrandingService {
  constructor(private prisma: PrismaService) {}

  async uploadLogo(
    companyId: string,
    file: UploadedLogoFile | undefined,
    type: LogoType = 'primary',
  ) {
    this.validateFile(file);

    const extension = detectImageExtension(file!.buffer);
    if (!extension) {
      throw new BadRequestException(
        'El archivo no es una imagen válida (PNG, JPG o WEBP)',
      );
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'branding', companyId);
    fs.mkdirSync(uploadsDir, { recursive: true });

    const safeName = `${type}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    fs.writeFileSync(path.join(uploadsDir, safeName), file!.buffer);

    const publicPath = `/uploads/branding/${companyId}/${safeName}`;
    const field = type === 'secondary' ? 'secondaryLogoUrl' : 'logoUrl';

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { [field]: publicPath },
      select: { id: true, logoUrl: true, secondaryLogoUrl: true },
    });

    return {
      companyId: company.id,
      logoUrl: company.logoUrl,
      secondaryLogoUrl: company.secondaryLogoUrl,
      message: 'Logo actualizado correctamente',
    };
  }

  private validateFile(file: UploadedLogoFile | undefined): void {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('El archivo es requerido');
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new BadRequestException('Formato no permitido. Usa PNG, JPG o WEBP');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato no permitido. Usa PNG, JPG o WEBP');
    }

    if (file.size > MAX_LOGO_SIZE) {
      throw new BadRequestException(
        'El archivo supera el tamaño máximo permitido (2MB)',
      );
    }
  }
}
