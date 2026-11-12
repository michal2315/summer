import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { catchError, concat, debounceTime, of, switchMap } from 'rxjs';
import { UserService } from '../../../../core/auth/user.service';
import { IQueryGroup, ISavedSearch, ISummarySearch } from '../../../../shared/models';
import { stripPaging } from '../../../../shared/services/search-history.service';
import { SummaryService } from '../../../../shared/services/summary.service';
import { NotificationsSettingsService } from '../../../notifications/notification-rules';
import { AdvancedSearchComponent } from '../../../summaries/advanced-search/advanced-search.component';
import { SAVED_SEARCH_KIND_LABEL, alertSearch, sameAlertSearch, savedSearchName } from '../../../summaries/search-query';
import { SummarySearchComponent } from '../../../summaries/summary-search/summary-search.component';

export interface SavedSearchEditorData {
  saved: ISavedSearch;
}

/**
 * Edit a saved search: its name and the search itself, the way it was made. A simple one edits the search box text;
 * an advanced one also has the condition builder. Its kind stays. An alert on the search follows the change (server).
 */
@Component({
  selector: 'app-saved-search-editor',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule, AdvancedSearchComponent, SummarySearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './saved-search-editor.component.html',
  styleUrl: './saved-search-editor.component.scss',
})
export class SavedSearchEditorComponent {
  private readonly data = inject<SavedSearchEditorData>(NZ_MODAL_DATA);
  readonly modal = inject(NzModalRef);
  private readonly users = inject(UserService);
  private readonly summaries = inject(SummaryService);
  private readonly alerts = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);

  readonly saved = this.data.saved;
  /** The search as saved: seeds the search box and the builder, which then report their changes. */
  readonly initial = stripPaging(this.saved.search);
  readonly advanced = this.saved.kind === 'advanced';
  readonly kindLabel = SAVED_SEARCH_KIND_LABEL[this.saved.kind];

  readonly name = signal(this.saved.name ?? savedSearchName(this.saved));
  readonly text = signal(this.initial.text ?? '');
  readonly query = signal<IQueryGroup | undefined>(this.initial.query);
  readonly busy = signal(false);

  readonly draft = computed<ISummarySearch>(() => ({ ...this.initial, text: this.text().trim() || undefined, query: this.query() }));
  readonly empty = computed(() => !Object.keys(alertSearch(this.draft())).length);
  /** Another saved search that is already this search (the server refuses a duplicate). */
  readonly clash = computed(() => this.users.user()?.pinnedSearches.find((s) => s._id !== this.saved._id && sameAlertSearch(s.search, this.draft())));
  readonly clashName = computed(() => {
    const c = this.clash();
    return c ? savedSearchName(c) : '';
  });
  readonly hasAlert =computed(() => !!this.alerts.alertFor(this.initial));

  /** How many summaries the edited search finds (null while counting). */
  readonly hits = toSignal(
    toObservable(this.draft).pipe(
      debounceTime(350),
      switchMap((s) => (Object.keys(alertSearch(s)).length ? concat(of(null), this.summaries.count(s).pipe(catchError(() => of(null)))) : of(null))),
    ),
    { initialValue: null },
  );

  constructor() {
    if (this.alerts.rules() === null) this.alerts.load();
  }

  /** Enter in the search box: take its text (the other filters stay as saved). */
  onSearch(s: ISummarySearch) {
    this.text.set(s.text ?? '');
  }

  save() {
    const name = this.name().trim();
    if (!name || this.empty() || this.clash() || this.busy()) return;
    this.busy.set(true);
    this.users.updateSearch(this.saved._id, { name, search: this.draft() }).subscribe({
      next: () => {
        // The server moved the alert onto the new search; refresh the rules so the bells match again.
        if (this.hasAlert()) this.alerts.load();
        this.message.success(this.hasAlert() ? 'החיפוש עודכן, וגם ההתראה עליו' : 'החיפוש עודכן');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
