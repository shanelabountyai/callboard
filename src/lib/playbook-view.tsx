import type { Playbook } from '@/generated/prisma/client';
import { cardLines } from './cards';

export const PLAYBOOK_FIELDS: [keyof Playbook & string, string, string][] = [
  ['staffing', 'Positions and headcount by hour', 'Greeter 8 to 9am: min 6, target 8'],
  ['breakPlan', 'Break plan', 'Two at a time from 10am, 15 minutes each'],
  ['floatPlan', 'Floats', 'Two floats from 7:30 to 10am, held at the info desk'],
  ['equipment', 'Equipment', '4 radios, channel 3'],
  ['setup', 'Setup checklist', 'Printers tested with a real badge'],
  ['close', 'Close checklist', 'Radios back to the charging station'],
  ['failurePoints', 'Known failure points', 'Badge printer 2 jams on the heavy stock'],
];

/** The playbook as the lead reads it: only the sections that say something. */
export function PlaybookView({ playbook }: { playbook: Playbook }) {
  return (
    <>
      {playbook.callOffsetMin !== null && <p>Call time: {playbook.callOffsetMin} minutes before the shift starts.</p>}
      {PLAYBOOK_FIELDS.filter(([k]) => cardLines(String(playbook[k])).length > 0).map(([k, label]) => (
        <div key={k}>
          <h4>{label}</h4>
          <ul>{cardLines(String(playbook[k])).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ))}
    </>
  );
}
