import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'arch-project-brief',
  standalone: true,
  imports: [FormsModule],
  template: `
  <h2 class="text-xl font-semibold mb-4">Project Brief</h2>
  <form class="grid gap-4 max-w-3xl" (ngSubmit)="save()">
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Project Type</span>
      <select class="border rounded px-3 py-2" [(ngModel)]="model.type" name="type">
        <option value="residential">Residential</option>
        <option value="commercial">Commercial</option>
        <option value="industrial">Industrial</option>
        <option value="mixed">Mixed-use</option>
      </select>
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Budget Range (USD)</span>
      <input class="border rounded px-3 py-2" [(ngModel)]="model.budget" name="budget" placeholder="e.g., 200k - 500k" />
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Timeline</span>
      <input class="border rounded px-3 py-2" [(ngModel)]="model.timeline" name="timeline" placeholder="e.g., 12 months" />
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Location</span>
      <input class="border rounded px-3 py-2" [(ngModel)]="model.location" name="location" placeholder="City, Country" />
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Lot Details</span>
      <textarea class="border rounded px-3 py-2" [(ngModel)]="model.lot" name="lot" placeholder="Area, frontage, access..."></textarea>
    </label>
    <label class="grid gap-1">
      <span class="text-sm text-gray-600">Zoning Information</span>
      <textarea class="border rounded px-3 py-2" [(ngModel)]="model.zoning" name="zoning" placeholder="Zoning code, FAR, height limits..."></textarea>
    </label>

    <div class="flex items-center gap-3">
      <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded">Save Draft</button>
      <span class="text-sm text-gray-500" *ngIf="savedAt">Saved {{savedAt}}</span>
    </div>
  </form>
  `
})
export class ProjectBriefPage {
  model: any = JSON.parse(localStorage.getItem('arch.projectBrief') || '{}');
  savedAt = '';
  save(){
    localStorage.setItem('arch.projectBrief', JSON.stringify(this.model));
    this.savedAt = new Date().toLocaleTimeString();
  }
}

