import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { ISavedSearch } from '../../../shared/models';
import { NotificationsSettingsService } from '../../notifications/notification-rules';
import { alertSearch, describeSearch, savedSearchName, searchToParams } from '../../summaries/search-query';

/** The user's saved searches on their own profile: open one in the feed, rename, remove, or turn it into an alert. */
@Component({
  selector: 'app-saved-searches',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzInputModule, NzPopconfirmModule, NzPopoverModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-searches.component.html',
  styleUrl: './saved-searches.component.scss',
})
export class SavedSearchesComponent {
  private readonly users = inject(UserService);
  private readonly alerts = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);

  readonly list = computed(() => this.users.user()?.pinnedSearches ?? []);
  readonly label = savedSearchName;
  readonly describe = describeSearch;

  /** The saved search whose rename popover is open. */
  readonly renaming = signal<string | null>(null);
  readonly renameValue = signal('');
  /** Ids with a request in flight (alert or rename). */
  readonly busy = signal(new Set<string>());

  constructor() {
    if (this.alerts.rules() === null) this.alerts.load();
  }

  open(s: ISavedSearch) {
    this.router.navigate(['/summaries'], { queryParams: searchToParams(s.search) });
  }

  // ---- rename / remove

  onRenamePopover(s: ISavedSearch, open: boolean) {
    this.renaming.set(open ? s._id : null);
    if (open) this.renameValue.set(this.label(s));
  }

  rename(s: ISavedSearch) {
    const name = this.renameValue().trim();
    if (!name || this.isBusy(s)) return;
    this.track(s, this.users.renameSearch(s._id, name), () => this.renaming.set(null));
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
