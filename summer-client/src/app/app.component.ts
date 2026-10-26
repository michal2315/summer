import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AltOverlayComponent } from './shared/keyboard/alt-overlay/alt-overlay.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AltOverlayComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {}
