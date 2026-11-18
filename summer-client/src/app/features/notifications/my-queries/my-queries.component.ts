import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { IQuery } from '../../../shared/models';
import { QueryService } from '../../../shared/services/query.service';
import { renderPages } from '../../../shared/utils/render-pages';
import { QUERY_KIND_LABEL, describeSearch, searchToParams } from '../../summaries/search-query';

/** The user's saved searches on the notifications page: run, favourite, share, alert on, edit or delete each. */
@Component({
  selector: 'app-my-queries',
  imports: [FormsModule, RouterLink, NzButtonModule, NzEmptyModule, NzIconModule, NzInputModule, NzPopconfirmModule, NzToolTipModule, InViewDirective, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-queries.component.html',
  styleUrl: './my-queries.component.scss',
})
export class MyQueriesComponent {
  readonly queries = inject(QueryService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  readonly filter = signal('');
  readonly filtered = computed(() => {
    const q = this.filter().trim();
    const list = this.queries.queries();
    return q ? list.filter((r) => r.name.includes(q) || describeSearch(r.search).includes(q)) : list;
  });
  readonly page = renderPages(this.filtered, 30, this.filter);
  readonly sharedCount = computed(() => this.queries.queries().filter((q) => q.isShared).length);
  readonly busy = signal(new Set<string>());

  constructor() {
    this.queries.ensureLoaded();
  }

  run(q: IQuery) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(q.search) });
  }

  toggleFavorite(q: IQuery) {
    if (!this.isBusy(q)) this.track(q, this.queries.update(q._id, { isFavorite: !q.isFavorite }), () => {});
  }

  toggleAlert(q: IQuery) {
    if (this.isBusy(q)) return;
    if (q.alert) this.track(q, this.queries.removeAlert(q._id), () => this.message.success('ההתראה על החיפוש בוטלה'));
    else this.track(q, this.queries.setAlert(q._id, { isActive: true }), () => this.message.success('תתקבל התראה על תמציות חדשות שמתאימות לחיפוש'));
  }

  /** Sharing lets everyone find, run, copy and alert on it; unsharing also stops the others' alerts. */
  toggleShared(q: IQuery) {
    if (this.isBusy(q)) return;
    this.track(q, this.queries.update(q._id, { isShared: !q.isShared }), (u) =>
      this.message.success(u.isShared ? 'החיפוש משותף: כולם יכולים למצוא אותו ולקבל עליו התראות' : 'החיפוש חזר להיות פרטי'),
    );
  }

  remove(q: IQuery) {
    this.track(q, this.queries.remove(q._id), () => this.message.success('החיפוש נמחק'));
  }

  unshareTitle(q: IQuery) {
    return q.followers ? `להפסיק לשתף? ${q.followers === 1 ? 'מי שעוקב/ת' : `${q.followers} העוקבים`} יפסיקו לקבל עליו התראות.` : '';
  }

  isBusy(q: IQuery) {
    return this.busy().has(q._id);
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
