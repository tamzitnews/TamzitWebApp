import { AppBar, Screen, T } from '@/components/ui';

// PLACEHOLDER — replaced by the owning agent.
export default function About() {
  return (
    <Screen header={<AppBar title="About" back />}>
      <T>About</T>
    </Screen>
  );
}
