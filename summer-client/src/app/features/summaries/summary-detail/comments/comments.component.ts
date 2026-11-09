import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { MentionOnSearchTypes, NzMentionModule } from 'ng-zorro-antd/mention';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { Subject, debounceTime, map, of, switchMap } from 'rxjs';
import { UserService } from '../../../../core/auth/user.service';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { IMention, IPermission, ISummary, ISummarySearch, SearchType, UserRef } from '../../../../shared/models';
import { HighlightPipe, RelativeTimePipe } from '../../../../shared/pipes/pipes';
import { CommentService } from '../../../../shared/services/comment.service';
import { PermissionService } from '../../../../shared/services/permission.service';

interface Suggestion {
  /** text inserted after the prefix (no spaces, so the mention survives as one token) */
  value: string;
  label: string;
  mention: IMention;
}

/** Comment list + composer. "@" mentions users or permission groups (they get notified). Replaces angular-mentions with nz-mention. */
@Component({
  selector: 'app-comments',
  imports: [FormsModule, RouterLink, NzButtonModule, NzIconModule, NzInputModule, NzMentionModule, NzPopconfirmModule, AvatarComponent, HighlightPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './comments.component.html',
  styleUrl: './comments.component.scss',
})
export class CommentsComponent {
  readonly users = inject(UserService);
  private readonly comments = inject(CommentService);
  private readonly permissions = inject(PermissionService);

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
        switchMap(({ value }) => {
          this.searching.set(true);
          const text = value.toLowerCase();
          // Pinned users first; a bare "@" lists only them.
          const pinned = (this.users.user()?.pinnedUsers ?? []).filter(
            (u) => !text || u.fullName.toLowerCase().includes(text) || u.username.toLowerCase().startsWith(text),
          );
          if (!value) return of(pinned.map(userSuggestion));
          const groups = this.permissions
            .list()
            .filter((p) => p.name.toLowerCase().includes(text))
            .map(groupSuggestion);
          return this.users.query(value).pipe(
            map((list) => [...pinned, ...list.filter((u) => !pinned.some((p) => p._id === u._id))].map(userSuggestion).concat(groups)),
          );
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
    const mentions = dedupe(this.selected.filter((s) => content.includes('@' + s.value)).map((s) => s.mention));
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

/** Group names may contain spaces; underscores keep the mention a single token. */
const groupSuggestion = (p: IPermission): Suggestion => {
  const value = p.name.trim().replace(/\s+/g, '_');
  return { value, label: `${p.name} (קבוצה)`, mention: { _id: p._id, type: 'permission', value, icon: '' } };
};

const dedupe = (list: IMention[]) => list.filter((m, i) => list.findIndex((x) => x._id === m._id && x.type === m.type) === i);
