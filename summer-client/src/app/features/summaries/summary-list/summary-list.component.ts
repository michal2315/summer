import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal } from '@angular/core';
import { format } from 'date-fns';
import { NzDividerModule } from 'ng-zorro-antd/divider';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { ISummary, ISummarySearch } from '../../../shared/models';
import { SummaryCardComponent } from '../summary-card/summary-card.component';
import { SummaryListStore } from '../summary-list.store';

interface Group {
  key: string;
  label: string | null;
  items: { summary: ISummary; index: number }[];
}

@Component({
  selector: 'app-summary-list',
  imports: [NzDividerModule, NzEmptyModule, NzSpinModule, InViewDirective, SummaryCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    role: 'feed',
    '[attr.aria-busy]': 'store.loading()',
    '(keydown.arrowdown)': 'move(1, $event)',
    '(keydown.arrowup)': 'move(-1, $event)',
    '(keydown.enter)': 'openFocused()',
  },
  template: `
    @for (group of groups(); track group.key) {
      @if (group.label) {
        <nz-divider [nzText]="group.label" nzOrientation="right" />
      }
      @for (item of group.items; track item.summary._id) {
        <app-summary-card
          [summary]="item.summary"
          [search]="search()"
          [active]="item.summary._id === openId()"
          [focused]="item.index === focusedIndex()"
          [selectable]="store.selectMode()"
          [selected]="store.selected().has(item.summary._id)"
          (selectToggle)="store.toggleSelected($event)"
          [attr.data-index]="item.index"
          (toggleOpen)="toggle.emit($event)"
        />
      }
    }

    @if (store.loading()) {
      <div class="loader"><nz-spin nzSimple /></div>
    } @else if (store.loaded() && !store.summaries().length) {
      <nz-empty class="empty" nzNotFoundImage="simple" nzNotFoundContent="לא נמצאו תוצאות" />
    }

    @if (store.hasMore()) {
      <div class="sentinel" (appInView)="store.loadMore()"></div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 6px; outline: none; padding-bottom: 24px; }
    // ant sets 16px on .ant-divider-with-text, which beats a plain element selector.
    :host ::ng-deep .ant-divider-with-text { margin: 4px 0 -2px; font-size: 12px; font-weight: 700; }
    .loader { display: grid; place-items: center; padding: 24px; }
    .empty { padding: 48px 0; }
    .sentinel { height: 1px; }
  `,
})
export class SummaryListComponent {
  readonly store = inject(SummaryListStore);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly search = input<ISummarySearch | null>(null);
  readonly openId = input<string | null>(null);
  readonly toggle = output<ISummary>();

  readonly focusedIndex = signal(-1);

  /** Group under an event-date divider only when sorted by event date — otherwise the dividers would be noise. */
  readonly groups = computed<Group[]>(() => {
    const list = this.store.summaries();
    const sort = this.search()?.sort ?? '-eventDate';
    if (!sort.endsWith('eventDate')) return [{ key: 'all', label: null, items: list.map((summary, index) => ({ summary, index })) }];
    const groups: Group[] = [];
    list.forEach((summary, index) => {
      const key = summary.eventDate ? format(new Date(summary.eventDate), 'dd/MM/yyyy') : 'ללא תאריך';
      const last = groups.at(-1);
      if (last?.key === key) last.items.push({ summary, index });
      else groups.push({ key, label: key, items: [{ summary, index }] });
    });
    return groups;
  });

  constructor() {
    // New result set → reset keyboard focus.
    effect(() => {
      this.store.version();
      this.focusedIndex.set(-1);
    });
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
