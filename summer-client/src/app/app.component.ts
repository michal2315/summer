import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { EasterEggsService } from './shared/easter-eggs/easter-eggs.service';
import { SummerFlashComponent } from './shared/easter-eggs/summer-flash/summer-flash.component';
import { TavorFlashComponent } from './shared/easter-eggs/tavor-flash/tavor-flash.component';
import { CoralFlashComponent } from './shared/easter-eggs/coral-flash/coral-flash.component';
import { TomerFlashComponent } from './shared/easter-eggs/tomer-flash/tomer-flash.component';
import { AltOverlayComponent } from './shared/keyboard/alt-overlay/alt-overlay.component';
import { TourOverlayComponent } from './shared/tour/tour-overlay/tour-overlay.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AltOverlayComponent, TourOverlayComponent, SummerFlashComponent, TavorFlashComponent, TomerFlashComponent, CoralFlashComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  constructor() {
    inject(EasterEggsService).watchTabTitle();
  }
}
