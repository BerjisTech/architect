import { Component } from '@angular/core';

@Component({
  selector: 'arch-checklist',
  standalone: true,
  template: `
  <h2 class="text-xl font-semibold mb-4">Regulatory Checklist</h2>
  <p class="text-gray-600 mb-3">Auto-generated based on location and project type (placeholder).</p>
  <ul class="list-disc pl-6 space-y-1">
    <li>Planning permit application</li>
    <li>Environmental impact screening</li>
    <li>Fire safety compliance</li>
    <li>Accessibility review</li>
    <li>Zoning compliance certificate</li>
  </ul>
  `
})
export class ChecklistPage {}

