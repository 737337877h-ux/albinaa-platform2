import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AgingService } from './aging.service';

export function nextMonthEndRun(now: Date) {
  const run = new Date(now);
  run.setHours(23, 55, 0, 0);
  while (new Date(run.getFullYear(), run.getMonth(), run.getDate() + 1).getMonth() === run.getMonth()) {
    run.setDate(run.getDate() + 1);
  }
  if (run.getTime() <= now.getTime()) {
    run.setMonth(run.getMonth() + 2, 0);
    run.setHours(23, 55, 0, 0);
  }
  return run;
}

@Injectable()
export class AgingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgingScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly aging: AgingService) {}

  onModuleInit() {
    if (process.env.AGING_MONTHLY_SNAPSHOT_ENABLED === 'false') return;
    this.schedule();
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    const next = nextMonthEndRun(new Date());
    this.scheduleAt(next);
    this.logger.log(`موعد إقفال أعمار الديون التالي: ${next.toISOString()}`);
  }

  private scheduleAt(target: Date) {
    const remaining = target.getTime() - Date.now();
    const delay = Math.max(1_000, Math.min(remaining, 2_147_000_000));
    this.timer = setTimeout(() => {
      if (Date.now() < target.getTime()) this.scheduleAt(target);
      else void this.run(target);
    }, delay);
    this.timer.unref?.();
  }

  private async run(asOf: Date) {
    try {
      await this.aging.createMonthlySnapshots(asOf);
    } catch (error) {
      this.logger.error('فشل إقفال لقطة أعمار الديون الشهرية', error instanceof Error ? error.stack : String(error));
    } finally {
      this.schedule();
    }
  }
}
