import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { ISavedSearch } from '../../../shared/models';
import { NotificationsSettingsService } from '../../notifications/notification-rules';
import { SAVED_SEARCH_KIND_LABEL, alertSearch, describeSearch, savedSearchName, searchToParams } from '../../summaries/search-query';
import { SavedSearchEditorComponent, SavedSearchEditorData } from './saved-search-editor/saved-search-editor.component';

/** The user's own saved searches on their profile: open one in the feed, favourite, edit, remove, or turn it into an alert. */
@Component({
  selector: 'app-saved-searches',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzPopconfirmModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-searches.component.html',
  styleUrl: './saved-searches.component.scss',
})
export class SavedSearchesComponent {
  private readonly users = inject(UserService);
  private readonly alerts = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  readonly list = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly label = savedSearchName;
  readonly describe = describeSearch;
  readonly kindLabel = SAVED_SEARCH_KIND_LABEL;

  /** Ids with a request in flight (alert or favourite). */
  readonly busy = signal(new Set<string>());

  constructor() {
    if (this.alerts.rules() === null) this.alerts.load();
  }

  open(s: ISavedSearch) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(s.search) });
  }

  // ---- favourite / edit / remove

  /** Favourites come first wherever saved searches are listed. */
  toggleFavorite(s: ISavedSearch) {
    if (this.isBusy(s)) return;
    this.track(s, this.users.updateSearch(s._id, { isFavorite: !s.isFavorite }), () => {});
  }

  edit(s: ISavedSearch) {
    this.modal.create<SavedSearchEditorComponent, SavedSearchEditorData, boolean>({
      nzTitle: 'עריכת חיפוש שמור',
      nzContent: SavedSearchEditorComponent,
      nzData: { saved: s },
      nzFooter: null,
      nzWidth: s.kind === 'advanced' ? 760 : 520,
    });
  }

  remove(s: ISavedSearch) {
    this.users.pinSearch(s.search, false).subscribe(() => this.message.success('החיפוש הוסר מהשמורים'));
  }

  // ---- alerts

  /** The alert rule for this search, if one exists. */
  alertFor(s: ISavedSearch) {
    return this.alerts.alertFor(s.search);
  }

  /** A search that selects nothing (e.g. only a sort) can't become an alert. */
  canAlert(s: ISavedSearch) {
    return Object.keys(alertSearch(s.search)).length > 0;
  }

  toggleAlert(s: ISavedSearch) {
    if (this.isBusy(s)) return;
    const existing = this.alertFor(s);
    if (existing?._id) {
      this.track(s, this.alerts.delete(existing._id), () => this.message.success('ההתראה על החיפוש בוטלה'));
    } else {
      this.track(s, this.alerts.addAlert(s.search, s.name), () => this.message.success('תתקבל התראה על תמציות חדשות שמתאימות לחיפוש'));
    }
  }

  isBusy(s: ISavedSearch) {
    return this.busy().has(s._id);
  }

  private track(s: ISavedSearch, req: Observable<unknown>, next: () => void) {
    const set = (on: boolean) =>
      this.busy.update((b) => {
        const copy = new Set(b);
        if (on) copy.add(s._id);
        else copy.delete(s._id);
        return copy;
      });
    set(true);
    req.subscribe({ next, error: () => set(false), complete: () => set(false) });
  }
}
