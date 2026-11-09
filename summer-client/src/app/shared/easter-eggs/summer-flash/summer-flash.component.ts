import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EasterEggsService } from '../easter-eggs.service';
import { SummyComponent } from '../summy/summy.component';

/** Floating beach emoji: what, where across the screen (%), and how late it rises (s). */
const FLOATERS = [
  { emoji: '🌴', left: 6, delay: 0.1 },
  { emoji: '🍉', left: 20, delay: 0.35 },
  { emoji: '🏖️', left: 34, delay: 0 },
  { emoji: '🕶️', left: 64, delay: 0.25 },
  { emoji: '🍦', left: 78, delay: 0.05 },
  { emoji: '🐚', left: 92, delay: 0.4 },
];

/** The "summer" search easter egg: a warm wash, Summy rising over the waves, beach emoji floating up. */
@Component({
  selector: 'app-summer-flash',
  imports: [SummyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summer-flash.component.html',
  styleUrl: './summer-flash.component.scss',
})
export class SummerFlashComponent {
  readonly eggs = inject(EasterEggsService);
  readonly floaters = FLOATERS;
}
