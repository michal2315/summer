import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { CardSkeletonComponent } from '../../../shared/components/card-skeleton/card-skeleton.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { ResizablePageComponent } from '../../../shared/components/resizable-page/resizable-page.component';
import { ICollection } from '../../../shared/models';
import { CollectionService } from '../../../shared/services/collection.service';
import { CollectionEditorData, CollectionEditorModalComponent } from '../collection-editor-modal/collection-editor-modal.component';
import { CollectionCardComponent } from '../collection-card/collection-card.component';
import { SelectedCollectionComponent } from '../selected-collection/selected-collection.component';

const PAGE = 20;

/** /collections — searchable, infinitely scrolled list of collections; details of the selected one in the aside. */
@Component({
  selector: 'app-collections-page',
  imports: [
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzSwitchModule,
    CardSkeletonComponent,
    InViewDirective,
    ResizablePageComponent,
    CollectionCardComponent,
    SelectedCollectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collections-page.component.html',
  styleUrl: './collections-page.component.scss',
})
export class CollectionsPageComponent {
  private readonly service = inject(CollectionService);
  private readonly users = inject(UserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modal = inject(NzModalService);

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly selectedId = computed<string | null>(() => this.params()['collectionId'] ?? null);

  readonly text = signal('');
  readonly all = signal(true);
  readonly items = signal<ICollection[]>([]);
  readonly loading = signal(false);
  readonly done = signal(false);
  private readonly text$ = new Subject<string>();
  private inflight?: Subscription;

  readonly pinned = computed(() => new Set(this.users.user()?.pinnedCollections ?? []));
  readonly favorites = computed(() => new Set(this.users.user()?.favoriteCollections ?? []));

  constructor() {
    this.text$.pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed()).subscribe((t) => this.text.set(t));
    effect(() => {
      this.text();
      this.all();
      untracked(() => this.reset());
    });
    this.service.changed$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.reset());
  }

  onText(t: string) {
    this.text$.next(t);
  }

  reset() {
    this.items.set([]);
    this.done.set(false);
    this.inflight?.unsubscribe();
    this.loading.set(false);
    this.loadMore();
  }

  loadMore() {
    const userId = this.users.userId();
    if (!userId || this.loading() || this.done()) return;
    this.loading.set(true);
    this.inflight = this.service
      .byUser(userId, { skip: this.items().length, text: this.text() || undefined, all: this.all(), getPrioritized: true })
      .subscribe({
        next: (page) => {
          this.items.update((cur) => [...cur, ...page]);
          this.done.set(page.length < PAGE);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.done.set(true);
        },
      });
  }

  select(c: ICollection) {
    this.router.navigate([], { relativeTo: this.route, queryParams: { collectionId: c._id === this.selectedId() ? null : c._id }, queryParamsHandling: 'merge' });
  }

  close() {
    this.router.navigate([], { relativeTo: this.route, queryParams: { collectionId: null }, queryParamsHandling: 'merge' });
  }

  open(c: ICollection) {
    this.router.navigate(['/collections', c._id]);
  }

  togglePin(c: ICollection) {
    this.users.pinCollection(c._id).subscribe();
  }

  toggleFavorite(c: ICollection) {
    this.users.favoriteEntity('collection', c._id).subscribe();
  }

  create() {
    this.modal
      .create<CollectionEditorModalComponent, CollectionEditorData, ICollection>({
        nzTitle: 'לקט חדש',
        nzContent: CollectionEditorModalComponent,
        nzData: {},
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((created) => created && this.select(created));
  }
}
