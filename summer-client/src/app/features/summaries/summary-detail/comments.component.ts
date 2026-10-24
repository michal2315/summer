import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { MentionOnSearchTypes, NzMentionModule } from 'ng-zorro-antd/mention';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { Subject, debounceTime, map, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar.component';
import { IMention, ISummary, ISummarySearch, SearchType, UserRef } from '../../../shared/models';
import { HighlightPipe, RelativeTimePipe } from '../../../shared/pipes/pipes';
import { CatalogService } from '../../../shared/services/catalog.service';
import { CommentService } from '../../../shared/services/comment.service';

interface Suggestion {
  /** text inserted after the prefix (no spaces, so the mention survives as one token) */
  value: string;
  label: string;
  mention: IMention;
}

/** Comment list + composer. "@" mentions users (they get notified), "#" mentions labels. Replaces angular-mentions with nz-mention. */
@Component({
  selector: 'app-comments',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzInputModule, NzMentionModule, NzPopconfirmModule, AvatarComponent, HighlightPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="comments" aria-label="תגובות">
      <h3>תגובות ({{ summary().comments.length }})</h3>

      <ul>
        @for (c of summary().comments; track c._id) {
          <li class="comment">
            <app-avatar [user]="c.user" [size]="32" />
            <div class="bubble">
              <div class="head">
                <a [routerLink]="['/profile', c.user._id]" class="name">{{ c.user.fullName }}</a>
                <span class="time">{{ c.creationDate | relativeTime }}</span>
                @if (c.user._id === users.userId()) {
                  <button
                    nz-button
                    nzType="text"
                    nzSize="small"
                    nz-popconfirm
                    nzPopconfirmTitle="למחוק את התגובה?"
                    nzOkText="מחיקה"
                    nzCancelText="ביטול"
                    (nzOnConfirm)="remove(c._id)"
                    aria-label="מחיקת תגובה"
                  >
                    <span nz-icon nzType="delete"></span>
                  </button>
                }
              </div>
              <p [innerHTML]="c.content | highlight: search() : T.Comments"></p>
            </div>
          </li>
        }
      </ul>

      <div class="composer">
        <nz-mention
          [nzSuggestions]="suggestions()"
          [nzValueWith]="valueWith"
          [nzPrefix]="['@', '#']"
          [nzLoading]="searching()"
          (nzOnSearchChange)="onSearch($event)"
          (nzOnSelect)="onSelect($event)"
          nzNotFoundContent="לא נמצאו תוצאות"
        >
          <textarea
            nz-input
            nzMentionTrigger
            [(ngModel)]="text"
            [nzAutosize]="{ minRows: 2, maxRows: 6 }"
            placeholder="הוספת תגובה… @ לתיוג משתמש, # לתגית"
            aria-label="תגובה חדשה"
            (keydown.control.enter)="submit()"
            (keydown.meta.enter)="submit()"
          ></textarea>
          <ng-container *nzMentionSuggestion="let s">{{ s.label }}</ng-container>
        </nz-mention>
        <button nz-button nzType="primary" [disabled]="!text().trim()" [nzLoading]="sending()" (click)="submit()">שליחה</button>
      </div>
    </section>
  `,
  styles: `
    .comments { border-top: 1px solid #f0f0f0; padding-top: 12px; }
    h3 { font-size: 13px; font-weight: 800; margin: 0 0 6px; }
    ul { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .comment { display: flex; gap: 8px; align-items: flex-start; }
    .bubble { background: #f7f7f7; border-radius: 10px; padding: 4px 10px; font-size: 12.5px; flex: 1; min-width: 0; }
    .head { display: flex; align-items: center; gap: 8px; }
    .name { font-weight: 700; color: #05043d; }
    .time { font-size: 11px; color: #9b9bb1; }
    .head button { margin-inline-start: auto; }
    p { margin: 2px 0 0; white-space: pre-wrap; word-break: break-word; }
    .composer { display: flex; gap: 8px; align-items: flex-end; }
    nz-mention { flex: 1; }
  `,
})
export class CommentsComponent {
  readonly users = inject(UserService);
  private readonly catalog = inject(CatalogService);
  private readonly comments = inject(CommentService);

  readonly summary = input.required<ISummary>();
  readonly search = input<ISummarySearch | null>(null);
  readonly summaryChange = output<ISummary>();

  readonly T = SearchType;
  readonly text = signal('');
  readonly suggestions = signal<Suggestion[]>([]);
  readonly searching = signal(false);
  readonly sending = signal(false);
  private selected: Suggestion[] = [];
  private readonly query$ = new Subject<MentionOnSearchTypes>();

  readonly valueWith = (s: Suggestion) => s.value;

  constructor() {
    this.query$
      .pipe(
        debounceTime(200),
        switchMap(({ value, prefix }) => {
          this.searching.set(true);
          if (prefix === '#') return this.catalog.labels(value).pipe(map((list) => list.map(labelSuggestion)));
          return value ? this.users.query(value).pipe(map((list) => list.map(userSuggestion))) : of([]);
        }),
      )
      .subscribe((list) => {
        this.suggestions.set(list);
        this.searching.set(false);
      });
  }

  onSearch(e: MentionOnSearchTypes) {
    this.query$.next(e);
  }

  onSelect(s: Suggestion) {
    this.selected.push(s);
  }

  submit() {
    const content = this.text().trim();
    if (!content || this.sending()) return;
    // Only keep mentions still present in the final text.
    const mentions = dedupe(this.selected.filter((s) => content.includes((s.mention.type === 'user' ? '@' : '#') + s.value)).map((s) => s.mention));
    const s = this.summary();
    this.sending.set(true);
    this.comments.add(s._id, content, mentions).subscribe({
      next: (comment) => {
        this.summaryChange.emit({ ...s, comments: [...s.comments, comment] });
        this.text.set('');
        this.selected = [];
        this.sending.set(false);
      },
      error: () => this.sending.set(false),
    });
  }

  remove(commentId: string) {
    const s = this.summary();
    this.comments.delete(commentId, s._id).subscribe(() => this.summaryChange.emit({ ...s, comments: s.comments.filter((c) => c._id !== commentId) }));
  }
}

const userSuggestion = (u: UserRef): Suggestion => ({
  value: u.username,
  label: `${u.fullName}${u.department ? ' - ' + u.department : ''}`,
  mention: { _id: u._id, type: 'user', value: u.username, icon: '' },
});

const labelSuggestion = (label: string): Suggestion => ({
  value: label.replace(/\s+/g, '_'),
  label: `#${label}`,
  mention: { _id: label, type: 'label', value: label, icon: '' },
});

const dedupe = (list: IMention[]) => list.filter((m, i) => list.findIndex((x) => x._id === m._id && x.type === m.type) === i);
