import { Component } from '@angular/core';

@Component({
  selector: 'arch-matching',
  standalone: true,
  templateUrl: './matching.page.html'
})
export class MatchingPage {
  demo = [
    { name: 'Studio A', specialty: 'Residential', city: 'Nairobi' },
    { name: 'Design Co.', specialty: 'Commercial', city: 'Kisumu' },
    { name: 'GreenBuild', specialty: 'Sustainable', city: 'Mombasa' },
  ];
}
