import { Role } from '@cvc/shared';

// Scaffold landing page; real UI lands in Phase 6.
export function App() {
  return (
    <main className="app">
      <h1>CVC</h1>
      <p>Project scaffold — Phase 1.</p>
      <small>{Object.values(Role).length} roles wired from @cvc/shared</small>
    </main>
  );
}