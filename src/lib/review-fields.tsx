import { OUTCOME_LABEL, OUTCOMES, outcomeOf, TIER_LABEL, type SheetArea, type Tier } from './review';
import { fmtTime, fmtWhen } from './time';

const TONE = { 1: 'confirmed', 2: 'invited', 3: 'overdue' } as const; // the pill's existing green, neutral and red

/** The People page only. The reason rides along so nobody has to take the word on trust. */
export const TierPill = ({ t }: { t: Tier }) => <span className="pill" data-status={TONE[t.tier]} title={t.why}>{TIER_LABEL[t.tier]}</span>;

/**
 * One area's review form body, shared by the lead's page and the planner's: tick who you would not have
 * back, and one note. What happened comes from check-in; only the planner's form (`outcomes`) can change it.
 */
export function ReviewFields({ area, event, outcomes }: { area: SheetArea; event: { graceMin: number; timezone: string }; outcomes?: boolean }) {
  const tz = event.timezone;
  const rows = area.positions.flatMap((position) => position.shifts.flatMap((shift) => shift.assignments.map((a) => ({ a, shift, position }))));
  return (
    <>
      <input type="hidden" name="areaId" value={area.id} />
      {rows.length === 0 ? <p>Nobody here has finished a shift, so there is only the note.</p> : (
        <fieldset>
          <legend>Anyone you would not have back? Tick their name.</legend>
          <ul className="plain">
            {rows.map(({ a, shift, position }) => (
              <li key={a.id} className="row">
                <input type="hidden" name={`p:${a.id}`} value="1" />
                <label className="grow">
                  <input type="checkbox" name={`no:${a.id}`} defaultChecked={a.review?.rehire === false} /> <strong>{a.person.name}</strong> · {position.name}, {fmtWhen(shift.startAt, tz)} ·{' '}
                  {a.checkedInAt ? `in ${fmtTime(a.checkedInAt, tz)} (call ${fmtTime(shift.callAt, tz)})` : 'never checked in'}
                  {a.checkedOutAt && `, out ${fmtTime(a.checkedOutAt, tz)}${a.checkOutMethod === 'auto' ? ' (closed automatically)' : ''}`}
                </label>
                {outcomes && (
                  <select name={`o:${a.id}`} defaultValue={outcomeOf({ ...a, shift: { ...shift, position }, event })} aria-label={`What happened: ${a.person.name}`}>
                    {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <label>Anything the planner should know? <textarea name="note" rows={3} maxLength={1000} defaultValue={area.review?.wentWrong} placeholder="Short from 8 to 9am. Printer 2 jammed twice. Or leave it empty." /></label>
    </>
  );
}
