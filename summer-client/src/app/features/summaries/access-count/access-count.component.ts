import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { Subscription } from 'rxjs';
import { IAccessStats, ISummarySearch } from '../../../shared/models';
import { SummaryService } from '../../../shared/services/summary.service';

/**
 * "מוצגות X מתוך Y" for a scope, plus how many summaries matching the search permissions hide. Hovering the hidden count
 * shows the permissions map: each missing permission, how many hidden summaries need it, and how many it alone hides.
 */
@Component({
  selector: 'app-access-count',
  imports: [NzIconModule, NzPopoverModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-count.component.html',
  styleUrl: './access-count.component.scss',
})
export class AccessCountComponent {
  private readonly summaries = inject(SummaryService);

  /** Summaries the current search shows. */
  readonly shown = input.required<number>();
  /** The scope (folders / noFolder); a new object reloads the counts. */
  readonly scope = input.required<ISummarySearch>();
  /** The search the list shows; hidden summaries are counted against it too. */
  readonly search = input<ISummarySearch>({});
  readonly searching = input(false);

  readonly stats = signal<IAccessStats | null>(null);
  /** The longest bar in the map. */
  readonly maxBlocking = computed(() => Math.max(1, ...(this.stats()?.missing.map((m) => m.blocking) ?? [])));

  constructor() {
    let request: Subscription | undefined;
    effect(() => {
      const query = { ...this.search(), ...this.scope(), sort: undefined, skip: undefined, limit: undefined };
      untracked(() => {
        request?.unsubscribe();
        request = this.summaries.accessStats(query).subscribe((s) => this.stats.set(s));
      });
    });
    inject(DestroyRef).onDestroy(() => request?.unsubscribe());
  }
}
