import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'arch-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.page.html'
})
export class HomePage {}
