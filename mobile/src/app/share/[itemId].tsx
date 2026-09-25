import { useLocalSearchParams } from 'expo-router';

import { ShareScreen } from '@/features/share/ShareScreen';

export default function Share() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  return <ShareScreen itemId={String(itemId ?? '')} />;
}
