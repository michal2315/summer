import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ICollection, UserRef } from '../../../shared/models';
import { DateFormatPipe } from '../../../shared/pipes/pipes';
import { CollectionService } from '../../../shared/services/collection.service';
import { CollectionEditorData, CollectionEditorModalComponent } from '../collection-editor-modal/collection-editor-modal.component';

/** Aside of /collections: one collection's details + manage actions (managers only). */
@Component({
  selector: 'app-selected-collection',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, NzToolTipModule, AvatarComponent, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './selected-collection.component.html',
  styleUrl: './selected-collection.component.scss',
})
export class SelectedCollectionComponent {
  private readonly service = inject(CollectionService);
  private readonly users = inject(UserService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  readonly collectionId = input.required<string>();
  readonly closed = output<void>();

  readonly collection = signal<ICollection | null>(null);
  readonly managers = signal<UserRef[]>([]);
  readonly isManager = computed(() => !!this.collection()?.managers.includes(this.users.userId() ?? ''));

  constructor() {
    effect(() => {
      const id = this.collectionId();
      untracked(() => this.load(id));
    });
  }

  private load(id: string) {
    this.collection.set(null);
    this.service.get(id).subscribe((c) => {
      this.collection.set(c);
      this.users.byIds(c.managers).subscribe((m) => this.managers.set(m));
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

  remove(c: ICollection) {
    this.modal.confirm({
      nzTitle: `למחוק את הלקט "${c.name}"?`,
      nzContent: 'התמציות שבלקט לא יימחקו.',
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) =>
          this.service.delete(c._id).subscribe({
            next: () => {
              this.message.success('הלקט נמחק');
              this.closed.emit();
              resolve();
            },
            error: reject,
          }),
        ),
    });
  }
}
