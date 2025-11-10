import { createAuthGuard } from '@berjis/angular-auth';

export const ensureAuthGuard = createAuthGuard({
  ensureOptions: { maxAgeMs: 1500 }
});

