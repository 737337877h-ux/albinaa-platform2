import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';
// Keep legacy keys stable for financial operations already queued by older apps.
export const Idempotent = (scope?: 'user') => SetMetadata(IDEMPOTENT_KEY, scope ?? true);
