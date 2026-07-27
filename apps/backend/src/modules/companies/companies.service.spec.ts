import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  let prisma: any;
  let service: CompaniesService;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn(),
        update: jest.fn((args: any) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
    };
    service = new CompaniesService(prisma);
  });

  it('findById returns the full company record (including profile/branding fields)', async () => {
    const company = {
      id: 'company-a',
      name: 'Tehus Rattan',
      logoUrl: '/uploads/branding/company-a/logo.png',
      primaryColor: '#A57014',
    };
    prisma.company.findUnique.mockResolvedValue(company);

    const result = await service.findById('company-a');

    expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { id: 'company-a' } });
    expect(result).toEqual(company);
  });

  it('update passes the full set of editable profile/branding fields through to Prisma', async () => {
    const data = {
      name: 'Tehus Rattan',
      phone: '+573000000000',
      businessType: 'Muebles',
      city: 'Medellín',
      country: 'Colombia',
      email: 'contacto@tehus.test',
      website: 'https://tehus.test',
      description: 'Muebles de rattan',
      primaryColor: '#A57014',
      accentColor: '#FDDC7F',
      backgroundColor: '#FAF8F3',
      settings: { sellsProducts: true },
    };

    await service.update('company-a', data);

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-a' },
      data,
    });
  });

  it('update only sends the fields provided (partial update)', async () => {
    await service.update('company-a', { city: 'Bogotá' });

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-a' },
      data: { city: 'Bogotá' },
    });
  });

  it('update passes the per-company fiscal identity fields through to Prisma', async () => {
    const data = {
      legalName: 'Empresa Ejemplo S.A.S',
      taxId: '900123456-7',
      address: 'Calle 10 #20-30',
      quoteFooter: 'Precios sujetos a cambio sin previo aviso.',
    };

    await service.update('company-a', data);

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-a' },
      data,
    });
  });

  it('update always scopes the write to the given company id (never a body id)', async () => {
    await service.update('company-a', { taxId: '900123456-7' });

    const args = prisma.company.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'company-a' });
    expect(args.data).not.toHaveProperty('id');
    expect(args.data).not.toHaveProperty('companyId');
  });

  it('update passes null through for a cleared fiscal field (sets the column to NULL)', async () => {
    await service.update('company-a', { taxId: null, quoteFooter: null });

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'company-a' },
      data: { taxId: null, quoteFooter: null },
    });
  });

  it('turns a duplicate-phone Prisma constraint error into a clean 409, not a raw 500', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`phone`)',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['phone'] } },
    );
    prisma.company.update.mockRejectedValue(prismaError);

    await expect(service.update('company-a', { phone: '+573001112233' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('rethrows any other error unchanged', async () => {
    prisma.company.update.mockRejectedValue(new Error('unexpected db error'));

    await expect(service.update('company-a', { name: 'X' })).rejects.toThrow(
      'unexpected db error',
    );
  });
});
