import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';
import { catchError, concat, debounceTime, of, switchMap } from 'rxjs';
import { QueryService } from '../../../../shared/services/query.service';
import { IQuery, IQueryGroup, ISummarySearch } from '../../../../shared/models';
import { stripPaging } from '../../../../shared/services/search-history.service';
import { SummaryService } from '../../../../shared/services/summary.service';
import { AdvancedSearchComponent } from '../../../summaries/advanced-search/advanced-search.component';
import { QUERY_KIND_LABEL, alertSearch, sameAlertSearch } from '../../../summaries/search-query';
import { SummarySearchComponent } from '../../../summaries/summary-search/summary-search.component';

export interface SavedSearchEditorData {
  saved: IQuery;
}

/**
 * Edit a saved search: its name and the search itself, the way it was made. A simple one edits the search box text;
 * an advanced one also has the condition builder. Its kind stays. Its alert, if any, is on the query, so it follows.
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
  private readonly queries = inject(QueryService);
  private readonly summaries = inject(SummaryService);
  private readonly message = inject(NzMessageService);
  private readonly router = inject(Router);

  readonly saved = this.data.saved;
  /** The search as saved: seeds the search box and the builder, which then report their changes. */
  readonly initial = stripPaging(this.saved.search);
  readonly advanced = this.saved.kind === 'advanced';
  readonly kindLabel = QUERY_KIND_LABEL[this.saved.kind];

  readonly name = signal(this.saved.name);
  readonly text = signal(this.initial.text ?? '');
  readonly query = signal<IQueryGroup | undefined>(this.initial.query);
  readonly busy = signal(false);

  readonly draft = computed<ISummarySearch>(() => ({ ...this.initial, text: this.text().trim() || undefined, query: this.query() }));
  readonly empty = computed(() => !Object.keys(alertSearch(this.draft())).length);
  /** Another saved search that is already this search (the server refuses a duplicate). */
  readonly clash = computed(() => this.queries.queries().find((s) => s._id !== this.saved._id && sameAlertSearch(s.search, this.draft())));
  readonly clashName = computed(() => {
    const c = this.clash();
    return c?.name ?? '';
  });
  readonly hasAlert = !!this.saved.alert;

  /** How many summaries the edited search finds (null while counting). */
  readonly hits = toSignal(
    toObservable(this.draft).pipe(
      debounceTime(350),
      switchMap((s) => (Object.keys(alertSearch(s)).length ? concat(of(null), this.summaries.count(s).pipe(catchError(() => of(null)))) : of(null))),
    ),
    { initialValue: null },
  );

  /** Enter in the search box: take its text (the other filters stay as saved). */
  onSearch(s: ISummarySearch) {
    this.text.set(s.text ?? '');
  }

  /** The full editor (kind, filters, alert channels) on its own page; changes made here are not kept. */
  openFull() {
    this.modal.close(false);
    this.router.navigate(['/notifications', this.saved._id, 'edit']);
  }

  save() {
    const name = this.name().trim();
    if (!name || this.empty() || this.clash() || this.busy()) return;
    this.busy.set(true);
    this.queries.update(this.saved._id, { name, search: this.draft() }).subscribe({
      next: () => {
        this.message.success(this.hasAlert ? 'החיפוש עודכן, וגם ההתראה עליו' : 'החיפוש עודכן');
        this.modal.close(true);
      },
      error: () => this.busy.set(false),
    });
  }
}
