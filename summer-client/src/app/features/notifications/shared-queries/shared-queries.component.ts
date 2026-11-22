import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable, Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IQuery } from '../../../shared/models';
import { QueryService } from '../../../shared/services/query.service';
import { QUERY_KIND_LABEL, describeSearch, searchToParams } from '../../summaries/search-query';

const PAGE = 30;

/**
 * Others' shared searches: find them by name or owner, run one in the feed, follow it (an alert of your own on their
 * query, which follows their edits) or copy it to your saved searches.
 */
@Component({
  selector: 'app-shared-queries',
  imports: [FormsModule, NzButtonModule, NzEmptyModule, NzIconModule, NzInputModule, NzToolTipModule, InViewDirective, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shared-queries.component.html',
  styleUrl: './shared-queries.component.scss',
})
export class SharedQueriesComponent {
  readonly queries = inject(QueryService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly destroyRef = inject(DestroyRef);

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  readonly text = signal('');
  private readonly text$ = new Subject<string>();
  /** Null while the first page loads. */
  readonly items = signal<IQuery[] | null>(null);
  readonly hasMore = signal(false);
  readonly loadingMore = signal(false);
  readonly busy = signal(new Set<string>());

  constructor() {
    this.queries.ensureLoaded();
    this.text$
      .pipe(
        startWith(''),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => {
          this.items.set(null);
          return this.queries.shared(t);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.items.set(list);
        this.hasMore.set(list.length === PAGE);
      });
  }

  setText(t: string) {
    this.text.set(t);
    this.text$.next(t.trim());
  }

  more() {
    const list = this.items();
    if (!list || !this.hasMore() || this.loadingMore()) return;
    this.loadingMore.set(true);
    this.queries.shared(this.text(), list.length).subscribe({
      next: (page) => {
        const seen = new Set(list.map((q) => q._id));
        this.items.set([...list, ...page.filter((q) => !seen.has(q._id))]);
        this.hasMore.set(page.length === PAGE);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  /** One of the user's own saved searches that is already this search, if any. */
  ownCopy(q: IQuery) {
    return this.queries.matching(q.search);
  }

  run(q: IQuery) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(q.search) });
  }

  /** Bell: follow (alert on their query) or stop following. */
  toggleFollow(q: IQuery) {
    if (this.isBusy(q)) return;
    const req = q.alert ? this.queries.removeAlert(q._id) : this.queries.setAlert(q._id, { isActive: true });
    this.track(q, req, (updated) => {
      this.replace(updated);
      this.message.success(updated.alert ? `תתקבל התראה על תמציות חדשות שמתאימות ל"${q.name}"` : 'ההתראה בוטלה');
    });
  }

  copy(q: IQuery) {
    if (this.isBusy(q) || this.ownCopy(q)) return;
    this.track(q, this.queries.copy(q._id), (mine) => this.message.success(`"${mine.name}" נשמר בחיפושים השמורים שלך`));
  }

  isBusy(q: IQuery) {
    return this.busy().has(q._id);
  }

  private replace(q: IQuery) {
    this.items.update((list) => list?.map((x) => (x._id === q._id ? q : x)) ?? list);
  }

  private track<T>(q: IQuery, req: Observable<T>, next: (v: T) => void) {
    const set = (on: boolean) =>
      this.busy.update((b) => {
        const copy = new Set(b);
        if (on) copy.add(q._id);
        else copy.delete(q._id);
        return copy;
      });
    set(true);
    req.subscribe({ next, error: () => set(false), complete: () => set(false) });
  }
}
