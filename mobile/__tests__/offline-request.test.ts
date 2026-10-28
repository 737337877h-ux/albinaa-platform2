import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const enqueueMutation = jest.fn<(...args: any[]) => Promise<void>>();
const resubmitMutation = jest.fn<(...args: any[]) => Promise<void>>();
const recordOfflineRequest = jest.fn<(...args: any[]) => Promise<void>>();

jest.mock('../src/db/database', () => ({
  enqueueMutation: (...args: any[]) => enqueueMutation(...args),
  resubmitMutation: (...args: any[]) => resubmitMutation(...args),
  recordOfflineRequest: (...args: any[]) => recordOfflineRequest(...args),
}));

import { saveOfflineDraft, submitOfflineDraft } from '../src/utils/offline-request';

describe('offline ONYX request drafts', () => {
  beforeEach(() => {
    enqueueMutation.mockReset();
    resubmitMutation.mockReset();
    recordOfflineRequest.mockReset();
    enqueueMutation.mockResolvedValue(undefined);
    resubmitMutation.mockResolvedValue(undefined);
    recordOfflineRequest.mockResolvedValue(undefined);
  });

  it('keeps Save draft local and out of the sync queue', async () => {
    const payload = { warehouseCode: '102', lines: [{ itemCode: '1001', quantity: 2 }] };

    await saveOfflineDraft({
      kind: 'inventory_count',
      title: 'جرد مخزون',
      endpoint: '/oracle-test-requests/inventory-counts',
      operationId: 'draft-1',
      payload,
    });

    expect(recordOfflineRequest).toHaveBeenCalledWith(
      'draft-1',
      'inventory_count',
      'جرد مخزون',
      '/oracle-test-requests/inventory-counts',
      payload,
      'draft',
    );
    expect(enqueueMutation).not.toHaveBeenCalled();
  });

  it('queues the same draft only after Inspect and send', async () => {
    const payload = { sourceWarehouseCode: '101', destinationWarehouseCode: '102', lines: [] };

    await submitOfflineDraft({
      kind: 'inventory_transfer',
      title: 'تحويل مخزني',
      endpoint: '/inventory-transfers',
      operationId: 'draft-2',
      payload,
    });

    expect(recordOfflineRequest).toHaveBeenCalledWith(
      'draft-2',
      'inventory_transfer',
      'تحويل مخزني',
      '/inventory-transfers',
      payload,
      'pending',
    );
    expect(resubmitMutation).toHaveBeenCalledWith(
      'draft-2',
      'POST',
      '/inventory-transfers',
      payload,
    );
    expect(enqueueMutation).not.toHaveBeenCalled();
  });
});
