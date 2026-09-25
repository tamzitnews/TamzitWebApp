import { Stack, useLocalSearchParams } from 'expo-router';

import { FeedbackSheet } from '@/features/feedback/FeedbackSheet';

export default function Feedback() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  return (
    <>
      {/* The sheet sits over the previous screen: no opaque screen background under the scrim. */}
      <Stack.Screen options={{ contentStyle: { backgroundColor: 'transparent' } }} />
      <FeedbackSheet itemId={String(itemId ?? '')} />
    </>
  );
}
