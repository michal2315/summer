import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Shimmering card placeholders shown while a card list loads. */
@Component({
  selector: 'app-card-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  templateUrl: './card-skeleton.component.html',
  styleUrl: './card-skeleton.component.scss',
})
export class CardSkeletonComponent {
  readonly count = input(3);
  readonly cards = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
