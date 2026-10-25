import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { UserService } from '../../../core/auth/user.service';
import { ICollection } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';
import { SummaryBrowserComponent } from '../../summaries/summary-browser/summary-browser.component';
import { CollectionEditorData, CollectionEditorModalComponent } from '../collection-editor-modal/collection-editor-modal.component';

/** /collections/:id — the collection's summaries with the full search/filter set, detail in the aside. */
@Component({
  selector: 'app-collection-summaries-page',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collection-summaries-page.component.html',
  styleUrl: './collection-summaries-page.component.scss',
})
export class CollectionSummariesPageComponent {
  private readonly service = inject(CollectionService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  readonly id = input.required<string>();
  /** Shown inside /hierarchy: no back-to-collections link, and summaries open in the hierarchy viewer instead of a side panel. */
  readonly embedded = input(false);
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
        nzTitle: 'עריכת לקט',
        nzContent: CollectionEditorModalComponent,
        nzData: { collection: c },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((saved) => saved && this.load(c._id));
  }
}
