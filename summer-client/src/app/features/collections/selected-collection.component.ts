import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../core/auth/user.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ICollection, UserRef } from '../../shared/models';
import { DateFormatPipe } from '../../shared/pipes/pipes';
import { CollectionService } from '../../shared/services/collection.service';
import { CollectionEditorData, CollectionEditorModalComponent } from './collection-editor-modal.component';

/** Aside of /collections: one collection's details + manage actions (managers only). */
@Component({
  selector: 'app-selected-collection',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, NzToolTipModule, AvatarComponent, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (collection(); as c) {
      <div class="pane">
        <div class="toolbar">
          <button nz-button nzType="text" nzShape="circle" type="button" (click)="closed.emit()" aria-label="סגירה"><span nz-icon nzType="close"></span></button>
          <span class="spacer"></span>
          @if (isManager()) {
            <button nz-button nzType="text" nzShape="circle" type="button" (click)="edit(c)" nz-tooltip="עריכת אוסף" aria-label="עריכת אוסף"><span nz-icon nzType="edit"></span></button>
            <button nz-button nzType="text" nzShape="circle" nzDanger type="button" (click)="remove(c)" nz-tooltip="מחיקת אוסף" aria-label="מחיקת אוסף"><span nz-icon nzType="delete"></span></button>
          }
        </div>

        <h2 class="name"><span nz-icon nzType="folder"></span> {{ c.name }}</h2>
        <a nz-button nzType="primary" nzBlock [routerLink]="['/collections', c._id]">פתיחת האוסף ({{ c.summaries.length }} סיכומים)</a>

        <dl>
          <dt>נוצר על ידי</dt>
          <dd>{{ c.createdBy.fullName }}</dd>
          <dt>נוצר</dt>
          <dd>{{ c.createdAt | dateFormat: 'dd/MM/yyyy' }}</dd>
          <dt>עודכן</dt>
          <dd>{{ c.updatedAt | dateFormat: 'dd/MM/yyyy' }}</dd>
        </dl>

        <h4>הרשאות</h4>
        <div class="chips">
          @for (p of c.permissions; track p._id) {
            <span class="perm"><i [style.background]="p.color"></i>{{ p.name }}</span>
          } @empty {
            <span class="muted">פתוח לכולם</span>
          }
        </div>

        <h4>מנהלים</h4>
        <ul class="managers">
          @for (m of managers(); track m._id) {
            <li><app-avatar [user]="m" [size]="24" /> <a [routerLink]="['/profile', m._id]">{{ m.fullName }}</a></li>
          }
        </ul>
      </div>
    } @else {
      <div class="pane"><nz-skeleton [nzActive]="true" /></div>
    }
  `,
  styles: `
    .pane { padding: 10px 14px 20px; display: flex; flex-direction: column; gap: 10px; }
    .toolbar { display: flex; align-items: center; gap: 2px; }
    .spacer { flex: 1; }
    .name { font-size: 18px; font-weight: 800; margin: 0; display: flex; gap: 6px; align-items: center; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
    dt { color: #9b9bb1; }
    dd { margin: 0; }
    h4 { margin: 4px 0 0; font-size: 13px; font-weight: 800; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .perm { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #efefef; padding: 1px 10px; border-radius: 12px; }
    .perm i { width: 8px; height: 8px; border-radius: 50%; }
    .managers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .managers li { display: flex; align-items: center; gap: 6px; }
  `,
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
        nzTitle: 'עריכת אוסף',
        nzContent: CollectionEditorModalComponent,
        nzData: { collection: c },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((saved) => saved && this.load(c._id));
  }

  remove(c: ICollection) {
    this.modal.confirm({
      nzTitle: `למחוק את האוסף "${c.name}"?`,
      nzContent: 'הסיכומים שבאוסף לא יימחקו.',
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () =>
        new Promise<void>((resolve, reject) =>
          this.service.delete(c._id).subscribe({
            next: () => {
              this.message.success('האוסף נמחק');
              this.closed.emit();
              resolve();
            },
            error: reject,
          }),
        ),
    });
  }
}
