import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NzContextMenuService, NzDropDownModule, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { IQuery } from '../../../shared/models';
import { QueryService } from '../../../shared/services/query.service';
import { QUERY_KIND_LABEL, describeSearch, searchToParams } from '../../summaries/search-query';
import { SavedSearchEditorComponent, SavedSearchEditorData } from './saved-search-editor/saved-search-editor.component';

/**
 * The user's saved searches (queries) as cards on the profile shelf. A card opens its search in the feed; its right-click menu
 * favourites, alerts, shares, edits or removes it.
 */
@Component({
  selector: 'app-saved-searches',
  imports: [NzDropDownModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-searches.component.html',
  styleUrl: './saved-searches.component.scss',
})
export class SavedSearchesComponent {
  readonly queries = inject(QueryService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);
  private readonly contextMenu = inject(NzContextMenuService);

  readonly describe = describeSearch;
  readonly kindLabel = QUERY_KIND_LABEL;

  /** Narrows the cards by name (the shelf's filter box). */
  readonly filter = input('');
  readonly list = computed(() => this.queries.search(this.filter(), Infinity));

  /** Ids with a request in flight. */
  readonly busy = signal(new Set<string>());

  constructor() {
    this.queries.ensureLoaded();
  }

  /** Right-click (or the keyboard menu key) on a card opens its actions. */
  openMenu(event: MouseEvent, menu: NzDropdownMenuComponent) {
    event.preventDefault();
    this.contextMenu.create(event, menu);
  }

  open(q: IQuery) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(q.search) });
  }

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
    this.modal.confirm({
      nzTitle: `להסיר את "${q.name}" מהחיפושים השמורים?`,
      nzContent: q.alert ? 'גם ההתראה עליו תימחק.' : undefined,
      nzOkText: 'הסרה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        this.queries.remove(q._id).subscribe(() => this.message.success(q.alert ? 'החיפוש הוסר מהשמורים, וגם ההתראה עליו' : 'החיפוש הוסר מהשמורים')),
    });
  }

  /** Share with everyone (they can find, run, copy and alert on it), or make private again (asks first if others follow it). */
  toggleShared(q: IQuery) {
    if (this.isBusy(q)) return;
    const run = () =>
      this.track(q, this.queries.update(q._id, { isShared: !q.isShared }), () =>
        this.message.success(q.isShared ? 'החיפוש חזר להיות פרטי' : 'החיפוש משותף: כולם יכולים למצוא אותו ולקבל עליו התראות'),
      );
    if (!(q.isShared && q.followers)) return run();
    this.modal.confirm({
      nzTitle: 'להפסיק לשתף?',
      nzContent: 'מי שעוקב אחרי החיפוש יפסיק לקבל עליו התראות.',
      nzOkText: 'הפסקת השיתוף',
      nzCancelText: 'חזרה',
      nzOnOk: run,
    });
  }

  /** Alert on this search (active), or stop. */
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
