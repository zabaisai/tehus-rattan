import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { Response } from 'express';
import { FILE_TOO_LARGE_MESSAGE } from './products-import.constants';

// Multer's own fileSize limit rejects the upload before ProductsImportService
// ever runs, via FileInterceptor throwing a PayloadTooLargeException whose
// message is multer's raw "File too large" — this rewrites that into the
// same clear, MB-aware message the service's own size check uses, so the
// client never sees the technical string regardless of which check fired.
@Catch(PayloadTooLargeException)
export class ProductImportFileSizeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(413).json({
      statusCode: 413,
      error: 'Payload Too Large',
      message: FILE_TOO_LARGE_MESSAGE,
    });
  }
}
