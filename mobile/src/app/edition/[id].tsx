import { useLocalSearchParams } from 'expo-router';

import { EditionViewScreen } from '@/features/edition/screens';

export default function EditionView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditionViewScreen id={String(id ?? '')} />;
}
