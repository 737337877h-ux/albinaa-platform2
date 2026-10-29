import { CustomersService } from './customers.service';

describe('financial adjustment journal preparation', () => {
  const actor = {
    id: 'user-1', organizationId: 'org-1', fullName: 'المراجع',
    permissions: ['customers.write', 'oracle_test_requests.journal.create'], roles: [],
  } as any;

  function subject() {
    const prisma = {
      financialAdjustmentRequest: {
        findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyByPermission: jest.fn().mockResolvedValue(undefined),
    };
    const oracleRequests = {
      catalog: jest.fn().mockResolvedValue({
        schema: 'IAS20261',
        parties: {
          customers: [{ code: '20011', linkedAccounts: [{
            accountCode: '112101001', analyticalAccountCode: '20011', analyticalType: 3,
            currencyCodes: ['YR'],
          }] }],
          other: [{ code: '312401001', linkedAccounts: [{
            accountCode: '312401001', analyticalAccountCode: '', analyticalType: 0,
            currencyCodes: ['YR'],
          }] }],
        },
      }),
      journalDryRun: jest.fn().mockResolvedValue({ valid: true, saveAllowed: true, issues: [] }),
      journalCreate: jest.fn().mockResolvedValue({
        created: true, requestNo: '18', requestSerial: '20260000010008500118', verified: true,
      }),
    };
    return {
      prisma,
      audit,
      notifications,
      oracleRequests,
      service: new CustomersService(prisma as any, audit as any, notifications as any, undefined, oracleRequests as any),
    };
  }

  it('validates and creates a balanced Oracle journal draft on approval', async () => {
    const { prisma, service, oracleRequests, audit } = subject();
    prisma.financialAdjustmentRequest.findFirst.mockResolvedValue({
      id: 'request-1', organizationId: 'org-1', customerId: 'customer-1',
      requestedBy: 'requester-1', requestType: 'discount', reason: 'تسوية فرق بسيط',
      currencyCode: 'YER', requestedAmount: 50_000, status: 'pending',
      customer: { name: 'عميل الاختبار', externalCustomerCode: '20011' },
    });
    prisma.financialAdjustmentRequest.update.mockImplementation(({ data }: any) => Promise.resolve({
      id: 'request-1', ...data,
    }));

    const result = await service.reviewFinancialAdjustmentRequest(actor, 'request-1', {
      decision: 'approved', reviewNotes: 'موافق',
    });

    expect(prisma.financialAdjustmentRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'approved',
        journalStatus: 'created_in_oracle',
        journalDraft: expect.objectContaining({
          oracleWritePerformed: true,
          requestNo: '18',
          lines: [
            expect.objectContaining({ direction: 'debit', accountCode: '312401001', analyticalType: 0, currencyCode: 'YR' }),
            expect.objectContaining({ direction: 'credit', accountCode: '112101001', analyticalAccountCode: '20011', analyticalType: 3, currencyCode: 'YR' }),
          ],
        }),
      }),
    }));
    expect(oracleRequests.journalDryRun).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: 'financial-adjustment:request-1',
    }));
    expect(oracleRequests.journalCreate).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'oracle_test_request_created', entityTable: 'IAS20261',
    }));
    expect(result.journalDraft).toEqual(expect.objectContaining({ status: 'created_in_oracle' }));
  });

  it('rejects approval when the customer account does not allow the request currency', async () => {
    const { prisma, service, oracleRequests } = subject();
    prisma.financialAdjustmentRequest.findFirst.mockResolvedValue({
      id: 'request-2', organizationId: 'org-1', customerId: 'customer-1',
      requestedBy: 'requester-1', requestType: 'settlement', reason: 'إغلاق الرصيد',
      currencyCode: 'SAR', requestedAmount: 30, status: 'pending',
      customer: { name: 'عميل الاختبار', externalCustomerCode: '20011' },
    });

    await expect(service.reviewFinancialAdjustmentRequest(actor, 'request-2', {
      decision: 'approved',
    })).rejects.toThrow('غير مفعّل بعملة SAR');
    expect(oracleRequests.journalDryRun).not.toHaveBeenCalled();
    expect(oracleRequests.journalCreate).not.toHaveBeenCalled();
    expect(prisma.financialAdjustmentRequest.update).not.toHaveBeenCalled();
  });

  it('returns the stored draft only for an approved request in the same organization', async () => {
    const { prisma, service } = subject();
    prisma.financialAdjustmentRequest.findFirst.mockResolvedValue({
      id: 'request-1', journalStatus: 'prepared_for_oracle_dry_run',
      journalDraft: { externalReference: 'financial-adjustment:request-1' },
      customer: { id: 'customer-1', name: 'عميل الاختبار', externalCustomerCode: '20011' },
    });

    await expect(service.financialAdjustmentJournalDraft(actor, 'request-1')).resolves.toEqual(
      expect.objectContaining({ journalStatus: 'prepared_for_oracle_dry_run' }),
    );
    expect(prisma.financialAdjustmentRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', organizationId: 'org-1', status: 'approved' },
    }));
  });
});
