import { NewOptions } from './NewSheet';
import { openNewSheet } from '../lib/newSheet';

// First run: one screen, one job. Nothing else until there is material.
export default function FirstRun() {
  return (
    <section className="first-run" aria-labelledby="first-run-title">
      <h1 id="first-run-title" className="c-title">Add your first material</h1>
      <NewOptions onPick={mode => openNewSheet(mode)} />
      <style jsx>{`
        .first-run { display: grid; gap: 28px; width: min(560px, 100%); margin: 8vh auto 0; text-align: center; }
      `}</style>
    </section>
  );
}
