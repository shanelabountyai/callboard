import { drainOutbox, sweepOutbox } from '@/modules/notifications/outbox'; // notifications
import '@/lib/messages'; // registers Callboard's templates before the drain // notifications
import { runDayOf } from '@/lib/dayof';
import { runReminders } from '@/lib/reminders';
import { runReviewAsks } from '@/lib/review';
import { startDue } from '@/lib/stages';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  jobs.started = await startDue(); // staffing becomes running at the start of the first day
  jobs.reminders = await runReminders();
  jobs.dayOf = await runDayOf(); // no-show alerts and escalation need the 5-minute schedule in vercel.json
  jobs.reviews = await runReviewAsks();
  jobs.outbox = { ...(await drainOutbox()), swept: await sweepOutbox() }; // notifications
  return jobs;
}
