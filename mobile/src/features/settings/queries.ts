import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';

export type AppMessage = {
  id: string;
  profile_id: string;
  title: string;
  body: string;
  item_id: string | null;
  created_at: string;
  read_at: string | null;
};

export const messagesKey = ['messages'] as const;

/** In-app messages from the editors (replies, corrections), newest first. */
export function useMessages(enabled = true) {
  return useQuery({
    queryKey: messagesKey,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_messages').select('*').order('created_at', { ascending: false });
      if (error) throw new ApiError(error.message);
      return (data ?? []) as AppMessage[];
    },
  });
}

/** Marks the given messages as read. */
export async function markMessagesRead(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from('app_messages').update({ read_at: new Date().toISOString() }).in('id', ids);
  if (error) throw new ApiError(error.message);
}
