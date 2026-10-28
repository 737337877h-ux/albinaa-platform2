import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../common/guards/jwt-auth.guard';
import { OracleAdvanceLedgerService } from './oracle-advance-ledger.service';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class OracleAdvanceSyncService {
  constructor(private readonly ledger: OracleAdvanceLedgerService, private readonly tasks: TasksService) {}

  async sync(actor: AuthUser, dryRun: boolean, req?: Request) {
    // Manual and scheduled sync publish the same reconciled ledger snapshot.
    const result = await this.ledger.sync(actor, dryRun);
    if (dryRun || !result.balancesUpdated) return result;
    const refresh = await this.tasks.generateToday(actor, req);
    return { ...result, tasksCreated: refresh.createdTasks, tasksAssigned: refresh.assignedTasks ?? 0,
      tasksUnassigned: refresh.unassignedTasks ?? 0 };
  }
}
