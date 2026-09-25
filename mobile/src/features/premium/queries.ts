import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

export type FamilyMember = {
  owner_id: string;
  member_phone: string;
  member_name: string | null;
  status: 'invited' | 'joined' | 'removed';
  invited_at: string;
  joined_at: string | null;
};

export const familyKey = ['family-members'] as const;

/** The family owner's invited / joined members (RLS: own rows only). */
export function useFamilyMembers(ownerId: string | undefined) {
  return useQuery({
    queryKey: [...familyKey, ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_family_members')
        .select('*')
        .eq('owner_id', ownerId!)
        .neq('status', 'removed')
        .order('invited_at', { ascending: true });
      if (error) throw new ApiError(error.message);
      return (data ?? []) as FamilyMember[];
    },
  });
}

export function useFamilyInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, name }: { phone: string; name: string }) => api.familyInvite(phone, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: familyKey });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

export function useFamilyRemove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => api.familyRemove(phone),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: familyKey });
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}
