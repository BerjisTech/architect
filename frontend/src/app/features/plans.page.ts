import { CommonModule } from '@angular/common';
import { Component, OnInit, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { StudioService } from '../core/services/studio.service';
import { StudioStateService } from '../core/state/studio-state.service';
import { FloorplanRecord } from '../models/floorplan.model';
import { TimeAgoPipe } from '../shared/pipes/time-ago.pipe';

@Component({
  selector: 'arch-plans',
  standalone: true,
  imports: [CommonModule, TimeAgoPipe],
  templateUrl: './plans.page.html'
})
export class PlansPage implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly router = inject(Router);
  private readonly studioState = inject(StudioStateService);

  loading = true;
  error = '';
  plans: FloorplanRecord[] = [];
  private readonly syncPlans = effect(() => {
    this.plans = this.studioState.plans();
  });

  async ngOnInit(): Promise<void> {
    await this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const fetchedPlans = await this.studio.list();
      this.studioState.setPlans(fetchedPlans);
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : 'Unable to load plans';
      this.studioState.reset();
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    await this.loadPlans();
  }

  startNew(): void {
    this.studioState.selectPlan(null);
    this.router.navigate(['/studio'], { queryParams: { new: '1' } });
  }

  open(plan: FloorplanRecord): void {
    this.studioState.selectPlan(plan.id);
    this.router.navigate(['/studio'], { queryParams: { plan: plan.id } });
  }
}
