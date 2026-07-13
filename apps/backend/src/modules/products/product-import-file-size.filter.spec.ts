import { PayloadTooLargeException } from '@nestjs/common';
import { ProductImportFileSizeFilter } from './product-import-file-size.filter';
import { FILE_TOO_LARGE_MESSAGE } from './products-import.constants';

describe('ProductImportFileSizeFilter', () => {
  it('rewrites the raw Multer "File too large" exception into a clear, MB-aware message', () => {
    const filter = new ProductImportFileSizeFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    } as any;

    filter.catch(new PayloadTooLargeException('File too large'), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 413, message: FILE_TOO_LARGE_MESSAGE }),
    );
    // Never leak Multer's raw technical string to the client.
    expect(json.mock.calls[0][0].message).not.toMatch(/File too large/i);
  });
});
