// In-memory state shared by the auth screens (not persisted): the registration payload, so the
// verify screen can resend the code, and a phone number to prefill after switching screens.
import { create } from 'zustand';

import type { AuthStartInput } from '@/lib/api';

type PendingAuth = {
  register: Extract<AuthStartInput, { mode: 'register' }> | null;
  prefillPhone: string | null;
  set: (patch: Partial<Pick<PendingAuth, 'register' | 'prefillPhone'>>) => void;
  clear: () => void;
};

export const usePendingAuth = create<PendingAuth>()((set) => ({
  register: null,
  prefillPhone: null,
  set: (patch) => set(patch),
  clear: () => set({ register: null, prefillPhone: null }),
}));
