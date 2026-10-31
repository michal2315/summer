import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { EasterEggsService } from '../easter-eggs.service';
import { SummyComponent } from '../summy/summy.component';

type ThingKind = 'note' | 'screw' | 'nail' | 'tack';

interface Thing {
  kind: ThingKind;
  /** sticky-note colour */
  color?: 'yellow' | 'pink' | 'blue' | 'green';
  /** across the screen, % */
  left: number;
  /** when it falls, s */
  delay: number;
  /** how far it turns on the way down, deg (negative = the other way) */
  spin: number;
  /** size factor */
  scale: number;
}

/**
 * Inside joke: Tomer throws things at the team when he visits. Blank sticky notes, screws, nails and blue-tack
 * rain down, tumbling.
 */
const THINGS: Thing[] = [
  { kind: 'note', color: 'yellow', left: 6, delay: 0.05, spin: 140, scale: 1 },
  { kind: 'screw', left: 14, delay: 0.35, spin: 540, scale: 1 },
  { kind: 'tack', left: 21, delay: 0.15, spin: 200, scale: 1 },
  { kind: 'note', color: 'pink', left: 29, delay: 0.5, spin: -160, scale: 0.85 },
  { kind: 'nail', left: 36, delay: 0.1, spin: -480, scale: 1 },
  { kind: 'note', color: 'blue', left: 44, delay: 0.7, spin: 110, scale: 0.9 },
  { kind: 'tack', left: 52, delay: 0.4, spin: -220, scale: 0.8 },
  { kind: 'screw', left: 58, delay: 0.6, spin: -600, scale: 0.85 },
  { kind: 'note', color: 'green', left: 66, delay: 0.2, spin: -130, scale: 1 },
  { kind: 'nail', left: 73, delay: 0.55, spin: 420, scale: 0.9 },
  { kind: 'tack', left: 80, delay: 0.25, spin: 260, scale: 1.1 },
  { kind: 'note', color: 'yellow', left: 87, delay: 0.45, spin: 170, scale: 0.9 },
  { kind: 'screw', left: 94, delay: 0.15, spin: 500, scale: 1 },
  { kind: 'note', color: 'pink', left: 50, delay: 0.85, spin: -120, scale: 0.8 },
];

/** The "tomer" search easter egg, for our product manager: Summy as Tomer, grinning with a clipboard, while office supplies rain down. */
@Component({
  selector: 'app-tomer-flash',
  imports: [SummyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tomer-flash.component.html',
  styleUrl: './tomer-flash.component.scss',
})
export class TomerFlashComponent {
  readonly eggs = inject(EasterEggsService);
  readonly things = THINGS;
}
