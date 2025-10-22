import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'arch-home',
  standalone: true,
  imports: [RouterLink],
  template: `
  <section class="space-y-4">
    <h1 class="text-2xl font-bold">Welcome</h1>
    <p class="text-gray-600">Start your project: create a brief, assess the site, match professionals, and plan consultations.</p>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <a routerLink="/project-brief" class="block p-4 border rounded hover:bg-gray-50">Project Brief</a>
      <a routerLink="/site-assessment" class="block p-4 border rounded hover:bg-gray-50">Site Assessment</a>
      <a routerLink="/matching" class="block p-4 border rounded hover:bg-gray-50">Professional Matching</a>
      <a routerLink="/consultation" class="block p-4 border rounded hover:bg-gray-50">Consultation Booking</a>
      <a routerLink="/regulatory-checklist" class="block p-4 border rounded hover:bg-gray-50">Regulatory Checklist</a>
    </div>
  </section>
  `
})
export class HomePage {}

