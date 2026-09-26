import { notFound } from 'next/navigation';
import { Refused } from '@/core/errors';

/** `.catch(onUnique('…'))`: a unique-constraint hit becomes a form error instead of a 500. */
export const onUnique = (message: string) => (e: unknown): never => {
  if ((e as { code?: string })?.code === 'P2002') throw new Refused(message);
  throw e;
};

/** A row that must exist in this org; null is "not yours" (spec §7b rule 3). */
export function must<T>(row: T | null | undefined): T {
  if (!row) notFound();
  return row;
}
