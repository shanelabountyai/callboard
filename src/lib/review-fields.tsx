import { OUTCOME_LABEL, OUTCOMES, outcomeOf, type SheetArea, type Tier } from './review';
import { fmtTime, fmtWhen } from './time';

const TONE = { 1: 'confirmed', 2: 'invited', 3: 'overdue' } as const; // the pill's existing green, neutral and red

/** Planner and lead screens only. The reason rides along so nobody has to take the number on trust. */
export const TierPill = ({ t }: { t: Tier }) => <span className="pill" data-status={TONE[t.tier]} title={t.why}>tier {t.tier}</span>;

/** One area's review form body, shared by the lead's page and the planner's. What happened is pre-filled from check-in. */
export function ReviewFields({ area, event }: { area: SheetArea; event: { graceMin: number; timezone: string } }) {
  const tz = event.timezone;
  const rows = area.positions.flatMap((position) => position.shifts.flatMap((shift) => shift.assignments.map((a) => ({ a, shift, position }))));
  return (
    <>
      <input type="hidden" name="areaId" value={area.id} />
      {rows.length === 0 && <p>Nobody was confirmed for this area, so there is only the area to review.</p>}
      <ul className="plain">
        {rows.map(({ a, shift, position }) => (
          <li key={a.id} className="row">
            <span className="grow">
              <strong>{a.person.name}</strong> · {position.name}, {fmtWhen(shift.startAt, tz)} ·{' '}
              {a.checkedInAt ? `in ${fmtTime(a.checkedInAt, tz)} (call ${fmtTime(shift.callAt, tz)})` : 'never checked in'}
              {a.checkedOutAt && `, out ${fmtTime(a.checkedOutAt, tz)}${a.checkOutMethod === 'auto' ? ' (closed automatically)' : ''}`}
            </span>
            <select name={`o:${a.id}`} defaultValue={outcomeOf({ ...a, shift: { ...shift, position }, event })} aria-label={`What happened: ${a.person.name}`}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
            </select>
            <select name={`r:${a.id}`} defaultValue={a.review?.rehire == null ? '' : a.review.rehire ? 'yes' : 'no'} aria-label={`Have ${a.person.name} back?`}>
              <option value="">Have them back? No opinion</option>
              <option value="yes">Have them back: yes</option>
              <option value="no">Have them back: no</option>
            </select>
            <input name={`n:${a.id}`} maxLength={500} defaultValue={a.review?.note ?? ''} placeholder="Note (optional)" aria-label={`Note on ${a.person.name}`} />
          </li>
        ))}
      </ul>
      <label>When were you short-staffed? <input name="understaffed" required maxLength={1000} defaultValue={area.review?.understaffed} placeholder="8 to 9am, or never" /></label>
      <label>When did you have too many people? <input name="overstaffed" required maxLength={1000} defaultValue={area.review?.overstaffed} placeholder="After 2pm, or never" /></label>
      <label>What went wrong? <input name="wentWrong" required maxLength={1000} defaultValue={area.review?.wentWrong} placeholder="Printer 2 jammed twice, or nothing" /></label>
    </>
  );
}
