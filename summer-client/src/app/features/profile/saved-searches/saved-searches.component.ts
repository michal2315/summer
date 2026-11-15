import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { IQuery } from '../../../shared/models';
import { QueryService } from '../../../shared/services/query.service';
import { QUERY_KIND_LABEL, describeSearch, searchToParams } from '../../summaries/search-query';
import { SavedSearchEditorComponent, SavedSearchEditorData } from './saved-search-editor/saved-search-editor.component';

/** Lists longer than this get a filter box. */
const FILTER_FROM = 6;

/** The user's saved searches (queries) on their profile: open one in the feed, favourite, edit, remove, or alert on it. */
@Component({
  selector: 'app-saved-searches',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzInputModule, NzPopconfirmModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-searches.component.html',
  styleUrl: './saved-searches.component.scss',
})
export class SavedSearchesComponent {
  readonly queries = inject(QueryService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  readonly filter = signal('');
  readonly showFilter = computed(() => this.queries.queries().length > FILTER_FROM);
  readonly list = computed(() => this.queries.search(this.filter(), Infinity));

  /** Ids with a request in flight (alert or favourite). */
  readonly busy = signal(new Set<string>());

  constructor() {
    this.queries.ensureLoaded();
  }

  open(q: IQuery) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(q.search) });
  }

  // ---- favourite / edit / remove

  /** Favourites come first wherever saved searches are listed. */
  toggleFavorite(q: IQuery) {
    if (this.isBusy(q)) return;
    this.track(q, this.queries.update(q._id, { isFavorite: !q.isFavorite }), () => {});
  }

  edit(q: IQuery) {
    this.modal.create<SavedSearchEditorComponent, SavedSearchEditorData, boolean>({
      nzTitle: 'עריכת חיפוש שמור',
      nzContent: SavedSearchEditorComponent,
      nzData: { saved: q },
      nzFooter: null,
      nzWidth: q.kind === 'advanced' ? 760 : 520,
    });
  }

  remove(q: IQuery) {
    this.queries.remove(q._id).subscribe(() => this.message.success(q.alert ? 'החיפוש הוסר מהשמורים, וגם ההתראה עליו' : 'החיפוש הוסר מהשמורים'));
  }

  // ---- alerts

  /** Bell: alert on this search (active), or stop. */
  toggleAlert(q: IQuery) {
    if (this.isBusy(q)) return;
    if (q.alert) this.track(q, this.queries.removeAlert(q._id), () => this.message.success('ההתראה על החיפוש בוטלה'));
    else this.track(q, this.queries.setAlert(q._id, { isActive: true }), () => this.message.success('תתקבל התראה על תמציות חדשות שמתאימות לחיפוש'));
  }

  isBusy(q: IQuery) {
    return this.busy().has(q._id);
  }

  private track(q: IQuery, req: Observable<unknown>, next: () => void) {
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
