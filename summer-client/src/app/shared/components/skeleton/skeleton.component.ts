import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Layouts the skeleton can take, each shaped like the content it stands in for:
 * rows — list rows (title + description + trailing pill); tree — compact icon + label rows;
 * tiles — a grid of cards (min column width from `--tile-min`); timeline — dated steps on a rail;
 * detail — a full summary (author, title, metadata, body); header — a profile header card;
 * form — label + input pairs; text — paragraph lines; chips — a row of round badges.
 */
export type SkeletonVariant = 'rows' | 'tree' | 'tiles' | 'timeline' | 'detail' | 'header' | 'form' | 'text' | 'chips';

/** Shimmering placeholders shown while content loads. For summary cards use app-card-skeleton. */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[class]': "'skeleton-' + variant()" },
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.scss',
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('rows');
  /** How many rows / tiles / steps / fields / lines / chips (ignored by detail and header). */
  readonly count = input(3);
  readonly items = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
