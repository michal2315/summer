import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { UserService } from '../../core/auth/user.service';
import { ICollection } from '../../shared/models';
import { CollectionService } from '../../shared/services/collection.service';
import { SummaryBrowserComponent } from '../summaries/summary-browser/summary-browser.component';
import { CollectionEditorData, CollectionEditorModalComponent } from './collection-editor-modal.component';

/** /collections/:id — the collection's summaries with the full search/filter set, detail in the aside. */
@Component({
  selector: 'app-collection-summaries-page',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (collection(); as c) {
      <app-summary-browser [ownerId]="userId()!" [collection]="c" [searchPlaceholder]="'חיפוש בתוך ' + c.name">
        <header browser-header class="header">
          <a routerLink="/collections" class="back"><span nz-icon nzType="arrow-right"></span> אוספים</a>
          <h1 class="page-title"><span nz-icon nzType="folder-open"></span> {{ c.name }}</h1>
          <span class="perms">
            @for (p of c.permissions; track p._id) {
              <span class="perm"><i [style.background]="p.color"></i>{{ p.name }}</span>
            }
          </span>
          <span class="spacer"></span>
          @if (isManager()) {
            <button nz-button type="button" (click)="edit(c)"><span nz-icon nzType="edit"></span> עריכה</button>
          }
          <a nz-button nzType="primary" routerLink="/summaries/new"><span nz-icon nzType="plus"></span> סיכום חדש</a>
        </header>
      </app-summary-browser>
    } @else {
      <div class="loading"><nz-skeleton [nzActive]="true" /></div>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .back { font-size: 13px; color: #666; }
    .page-title { display: inline-flex; gap: 6px; align-items: center; }
    .perms { display: flex; gap: 6px; flex-wrap: wrap; }
    .perm { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #efefef; padding: 1px 10px; border-radius: 12px; }
    .perm i { width: 8px; height: 8px; border-radius: 50%; }
    .spacer { flex: 1; }
    .loading { padding: 24px; }
  `,
})
export class CollectionSummariesPageComponent {
  private readonly service = inject(CollectionService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  readonly id = input.required<string>();
  readonly collection = signal<ICollection | null>(null);
  readonly userId = this.users.userId;
  readonly isManager = computed(() => !!this.collection()?.managers.includes(this.users.userId() ?? ''));

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this.load(id));
    });
  }

  private load(id: string) {
    this.service.get(id).subscribe({
      next: (c) => this.collection.set(c),
      error: () => this.router.navigate(['/not-found'], { skipLocationChange: true }),
    });
  }

  edit(c: ICollection) {
    this.modal
      .create<CollectionEditorModalComponent, CollectionEditorData, ICollection>({
        nzTitle: 'עריכת אוסף',
        nzContent: CollectionEditorModalComponent,
        nzData: { collection: c },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((saved) => saved && this.load(c._id));
  }
}
