import { Injectable, signal } from '@angular/core';
import { FloorplanRecord } from '../../models/floorplan.model';

@Injectable({ providedIn: 'root' })
export class StudioStateService {
  readonly plans = signal<FloorplanRecord[]>([]);
  readonly selectedPlanId = signal<string | null>(null);

  setPlans(plans: FloorplanRecord[]): void {
    this.plans.set(plans);
  }

  upsertPlan(plan: FloorplanRecord): void {
    this.plans.update(current => {
      const next = [...current];
      const idx = next.findIndex(item => item.id === plan.id);
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...plan };
      } else {
        next.unshift(plan);
      }
      return next;
    });
  }

  removePlan(planId: string): void {
    this.plans.update(current => current.filter(item => item.id !== planId));
  }

  selectPlan(planId: string | null): void {
    this.selectedPlanId.set(planId);
  }

  reset(): void {
    this.plans.set([]);
    this.selectedPlanId.set(null);
  }
}

