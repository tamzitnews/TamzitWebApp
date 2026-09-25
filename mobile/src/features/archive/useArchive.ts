import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

/** How far back the archive reaches; premium readers widen it step by step ("מהדורות קודמות"). */
const STEPS = [30, 90, 180, 365, 730, 3650] as const;

/**
 * The archive list (app_archive), newest first. Starts with 30 days; `loadMore` widens the window
 * while keeping the current list on screen. `exhausted` turns on when widening found nothing new.
 */
export function useArchive() {
  const [step, setStep] = useState(0);
  const [grow, setGrow] = useState<{ step: number; before: number } | null>(null);
  const days = STEPS[step];
  const queryKey = [...qk.archive, days] as const;
  const query = useQuery({ queryKey, queryFn: () => api.archive(days), placeholderData: keepPreviousData });

  const count = query.data?.length ?? 0;
  const settled = !query.isPlaceholderData && !!query.data;
  const exhausted = step === STEPS.length - 1 || (!!grow && grow.step === step && settled && count <= grow.before);

  const loadMore = useCallback(() => {
    if (step >= STEPS.length - 1) return;
    setGrow({ step: step + 1, before: count });
    setStep(step + 1);
  }, [step, count]);

  return {
    query,
    queryKey,
    loadMore,
    exhausted,
    loadingMore: query.isPlaceholderData && query.isFetching,
  };
}
