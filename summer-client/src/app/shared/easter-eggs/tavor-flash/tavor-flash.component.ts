import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EasterEggsService } from '../easter-eggs.service';
import { SummyComponent } from '../summy/summy.component';

/** The "tavor" search easter egg: a red-dot reticle sweeps in and locks on, then Summy pops up in uniform, holding a Tavor. */
@Component({
  selector: 'app-tavor-flash',
  imports: [SummyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tavor-flash.component.html',
  styleUrl: './tavor-flash.component.scss',
})
export class TavorFlashComponent {
  readonly eggs = inject(EasterEggsService);
}
