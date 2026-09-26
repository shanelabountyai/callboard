import { drainOutbox, sweepOutbox } from '@/modules/notifications/outbox'; // notifications
import '@/lib/messages'; // registers Callboard's templates before the drain // notifications
import { runReminders } from '@/lib/reminders';

// Clone-owned (plan §3.2): /api/cron calls this after its own core sweeps. A clone adds its jobs here,
// and removing the notifications module deletes the lines marked `// notifications`.
export async function cronJobs(): Promise<Record<string, unknown>> {
  const jobs: Record<string, unknown> = {};
  jobs.reminders = await runReminders();
  jobs.outbox = { ...(await drainOutbox()), swept: await sweepOutbox() }; // notifications
  return jobs;
}
