import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Refetches a query when its screen regains focus (e.g. switching back to a tab), but only if the
 * data is stale and nothing is already loading. The first focus is skipped: the query loads anyway.
 */
export function useRefreshOnFocus(queryKey: QueryKey) {
  const qc = useQueryClient();
  const first = useRef(true);
  const hash = JSON.stringify(queryKey);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      const key = JSON.parse(hash) as QueryKey;
      const query = qc.getQueryCache().find({ queryKey: key, exact: true });
      if (query && query.isStale() && query.state.fetchStatus === 'idle') {
        qc.refetchQueries({ queryKey: key, exact: true });
      }
    }, [qc, hash]),
  );
}
