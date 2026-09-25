import { AppBar, Screen, T } from '@/components/ui';

// PLACEHOLDER — replaced by the owning agent.
export default function Welcome() {
  return (
    <Screen header={<AppBar title="Welcome" back />}>
      <T>Welcome</T>
    </Screen>
  );
}
