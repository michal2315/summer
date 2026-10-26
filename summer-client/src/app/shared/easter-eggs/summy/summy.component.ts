import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * search — magnifying glass, eyes scanning (no search results)
 * empty  — sunglasses, chilling (nothing here yet)
 * error  — dizzy and sweating (server error)
 * lost   — looking around with a question mark (404)
 * locked — holding a padlock (no permission)
 * soldier — helmet on, holding a Tavor (the "tavor" search)
 * target — winking through a red-dot reticle (a search with exactly one hit)
 */
export type SummyMood = 'search' | 'empty' | 'error' | 'lost' | 'locked' | 'soldier' | 'target';

/** Summy, Summer's sun mascot — an animated SVG for empty and error states. */
@Component({
  selector: 'app-summy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[class]': "'mood-' + mood()", '[style.--size.px]': 'size()' },
  templateUrl: './summy.component.html',
  styleUrl: './summy.component.scss',
})
export class SummyComponent {
  readonly mood = input<SummyMood>('empty');
  readonly size = input(96);
  readonly rays = Array.from({ length: 12 }, (_, i) => i * 30);
}
