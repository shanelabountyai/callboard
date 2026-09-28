import { RULES, show, type Rules } from './rules';

/** One input per rule. With `standard`, each rule that differs from it carries the marker (PRD 6). */
export function RuleFields({ values, standard }: { values: Rules; standard?: Rules }) {
  return (
    <>
      {RULES.map((r) => {
        const off = standard && values[r.key] !== standard[r.key];
        const mark = off && <strong className="badge" data-tone="amber">Deviates from standard ({show(r, standard[r.key])})</strong>;
        return 'text' in r ? (
          <label key={r.key}>{r.label} {mark}<textarea name={r.key} rows={2} cols={60} maxLength={1000} defaultValue={values[r.key]} /><small>{r.text}</small></label>
        ) : (
          <label key={r.key}>{r.label} {mark}<input name={r.key} type="number" min={r.min} max={r.max} required defaultValue={values[r.key]} /><small>{r.unit}</small></label>
        );
      })}
    </>
  );
}
