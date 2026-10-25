import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { format } from 'date-fns';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { Router } from '@angular/router';
import { ISummary, ISummaryParent, ISummarySearch } from '../../../shared/models';
import { SummaryCardComponent } from '../summary-card/summary-card.component';
import { SummaryListStore } from '../summary-list.store';

/** A card, or several sumaroons of one running summary bundled into a single row (feed only). */
type Item = { type: 'card'; key: string; summary: ISummary; index: number } | { type: 'bundle'; key: string; parent: ISummaryParent; sumaroons: ISummary[] };

interface Group {
  key: string;
  label: string | null;
  items: Item[];
}

/** Sumaroon titles a bundle row lists before "ועוד". */
const BUNDLE_PREVIEW = 3;

@Component({
  selector: 'app-summary-list',
  imports: [NzDividerModule, NzEmptyModule, NzIconModule, NzSpinModule, InViewDirective, SummaryCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    role: 'feed',
    '[attr.aria-busy]': 'store.loading()',
    '(keydown.arrowdown)': 'move(1, $event)',
    '(keydown.arrowup)': 'move(-1, $event)',
    '(keydown.enter)': 'openFocused()',
  },
  templateUrl: './summary-list.component.html',
  styleUrl: './summary-list.component.scss',
})
export class SummaryListComponent {
  readonly store = inject(SummaryListStore);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  /** Bundle sumaroons of the same running summary (2+ loaded) into one row. */
  readonly groupSumaroons = input(false);
  readonly bundlePreview = BUNDLE_PREVIEW;
  private readonly router = inject(Router);
  readonly toggle = output<ISummary>();

  readonly focusedIndex = signal(-1);

  /** Group under an event-date divider only when sorted by event date — otherwise the dividers would be noise. */
  readonly groups = computed<Group[]>(() => {
    const list = this.store.summaries();
    const sort = this.search()?.sort ?? '-eventDate';
    const items = this.items(list);
    if (!sort.endsWith('eventDate')) return [{ key: 'all', label: null, items }];
    const groups: Group[] = [];
    for (const item of items) {
      const first = item.type === 'card' ? item.summary : item.sumaroons[0];
      const key = first.eventDate ? format(new Date(first.eventDate), 'dd/MM/yyyy') : 'ללא תאריך';
      const last = groups.at(-1);
      if (last?.key === key) last.items.push(item);
      else groups.push({ key, label: key, items: [item] });
    }
    return groups;
  });

  constructor() {
    // New result set → reset keyboard focus.
    effect(() => {
      this.store.version();
      this.focusedIndex.set(-1);
    });
  }

  /** Cards in list order; with grouping, a running summary's 2+ sumaroons collapse into one bundle where the first appears. */
  private items(list: ISummary[]): Item[] {
    const cards = (): Item[] => list.map((summary, index) => ({ type: 'card', key: summary._id, summary, index }));
    if (!this.groupSumaroons()) return cards();
    const perParent = new Map<string, number>();
    for (const s of list) if (s.parentId) perParent.set(s.parentId, (perParent.get(s.parentId) ?? 0) + 1);
    const bundles = new Map<string, Extract<Item, { type: 'bundle' }>>();
    const items: Item[] = [];
    list.forEach((summary, index) => {
      const pid = summary.parentId;
      if (!pid || !summary.parent || (perParent.get(pid) ?? 0) < 2) {
        items.push({ type: 'card', key: summary._id, summary, index });
        return;
      }
      const bundle = bundles.get(pid);
      if (bundle) bundle.sumaroons.push(summary);
      else {
        const created: Extract<Item, { type: 'bundle' }> = { type: 'bundle', key: 'bundle-' + pid, parent: summary.parent, sumaroons: [summary] };
        bundles.set(pid, created);
        items.push(created);
      }
    });
    return items;
  }

  openRunning(id: string) {
    this.router.navigate(['/running', id]);
  }

  move(delta: number, event: Event) {
    const count = this.store.summaries().length;
    if (!count) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(count - 1, this.focusedIndex() + delta));
    this.focusedIndex.set(next);
    this.host.nativeElement.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (next >= count - 3) this.store.loadMore();
  }

  openFocused() {
    const s = this.store.summaries()[this.focusedIndex()];
    if (s) this.toggle.emit(s);
  }
}
