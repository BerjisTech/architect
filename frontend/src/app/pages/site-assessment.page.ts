import { Component } from '@angular/core';

@Component({
  selector: 'arch-site-assessment',
  standalone: true,
  templateUrl: './site-assessment.page.html'
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
