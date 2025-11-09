import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FloorplanRecord, StudioService } from '../services/studio.service';

@Component({
  selector: 'arch-plans',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './plans.page.html'
})
export class PlansPage implements OnInit {
  private readonly studio = inject(StudioService);
  private readonly router = inject(Router);

  loading = true;
  error = '';
  plans: FloorplanRecord[] = [];

  async ngOnInit(): Promise<void> {
    await this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.plans = await this.studio.list();
    } catch (err: unknown) {
      this.error = err instanceof Error ? err.message : 'Unable to load plans';
      this.plans = [];
    } finally {
      this.loading = false;
    }
  }

  async refresh(): Promise<void> {
    await this.loadPlans();
  }

  startNew(): void {
    this.router.navigate(['/studio'], { queryParams: { new: '1' } });
  }

  open(plan: FloorplanRecord): void {
    this.router.navigate(['/studio'], { queryParams: { plan: plan.id } });
  }

  updatedLabel(plan: FloorplanRecord): string {
    if (!plan.updatedAt) {
      return 'Never saved';
    }
    const date = new Date(plan.updatedAt);
    if (Number.isNaN(date.getTime())) {
      return plan.updatedAt;
    }
    return date.toLocaleString();
  }
}
