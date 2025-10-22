import { Component } from '@angular/core';

@Component({
  selector: 'arch-site-assessment',
  standalone: true,
  template: `
  <h2 class="text-xl font-semibold mb-4">Site Assessment</h2>
  <p class="text-gray-600 mb-4">Upload property documents, survey maps, soil tests, zoning certificates.</p>
  <div class="grid gap-3 max-w-2xl">
    <label class="block">
      <span class="text-sm text-gray-600">Select files</span>
      <input type="file" multiple class="mt-1" (change)="onFiles($event)" />
    </label>
    <ul class="list-disc pl-5 text-sm" *ngIf="files.length">
      <li *ngFor="let f of files">{{f.name}} ({{f.size}} bytes)</li>
    </ul>
    <button class="px-4 py-2 bg-blue-600 text-white rounded w-max" (click)="submit()">Submit</button>
    <p *ngIf="message" class="text-green-700">{{message}}</p>
  </div>
  `
})
export class SiteAssessmentPage {
  files: File[] = [];
  message = '';
  onFiles(e: any){ this.files = Array.from(e.target.files || []); }
  submit(){
    // TODO: POST to /svc/v1/site/assessments with FormData
    this.message = `Queued ${this.files.length} file(s) for upload`;
  }
}

