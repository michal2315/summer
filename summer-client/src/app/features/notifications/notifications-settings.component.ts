import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NotificationBellComponent } from '../../shared/components/notification-bell.component';
import { INotificationSettings } from '../../shared/models';
import { NotificationNamePipe, NotificationsSettingsService, describeRule } from './notification-rules';

/** /notifications — notification rules admin: list, filter, edit, delete. */
@Component({
  selector: 'app-notifications-settings',
  imports: [
    FormsModule,
    RouterLink,
    NzButtonModule,
    NzEmptyModule,
    NzIconModule,
    NzInputModule,
    NzPopconfirmModule,
    NzSkeletonModule,
    NzTagModule,
    NotificationBellComponent,
    NotificationNamePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="header">
        <h1 class="page-title"><span nz-icon nzType="notification"></span> ניהול התראות</h1>
        <span class="spacer"></span>
        <a nz-button nzType="primary" routerLink="create"><span nz-icon nzType="plus"></span> התראה חדשה</a>
        <app-notification-bell />
      </header>
      <p class="muted intro">כללים שמגדירים מתי תקבלו התראה על סיכום חדש — לפי ערכי השדות שלו. כל התנאים בכלל צריכים להתקיים.</p>

      <nz-input-group [nzPrefix]="searchIcon" class="filter">
        <input nz-input placeholder="סינון כללים" [ngModel]="service.filter()" (ngModelChange)="service.filter.set($event)" aria-label="סינון כללים" />
      </nz-input-group>
      <ng-template #searchIcon><span nz-icon nzType="search"></span></ng-template>

      @if (service.rules() === null) {
        <nz-skeleton [nzActive]="true" />
      } @else {
        <ul class="list">
          @for (r of filtered(); track r._id) {
            <li class="item">
              <div class="text">
                <strong>{{ r.name }}</strong>
                <span class="desc">{{ r | notificationName }}</span>
              </div>
              <span class="channels">
                @if (r.isNotify) {
                  <nz-tag><span nz-icon nzType="bell"></span> במערכת</nz-tag>
                }
                @if (r.isMail) {
                  <nz-tag><span nz-icon nzType="mail"></span> במייל</nz-tag>
                }
              </span>
              <span class="row-actions">
                <a nz-button nzType="text" nzShape="circle" [routerLink]="[r._id, 'edit']" aria-label="עריכה"><span nz-icon nzType="edit"></span></a>
                <button
                  nz-button
                  nzType="text"
                  nzShape="circle"
                  nzDanger
                  type="button"
                  nz-popconfirm
                  nzPopconfirmTitle="למחוק את הכלל?"
                  nzOkText="מחיקה"
                  nzCancelText="ביטול"
                  (nzOnConfirm)="remove(r)"
                  aria-label="מחיקה"
                >
                  <span nz-icon nzType="delete"></span>
                </button>
              </span>
            </li>
          } @empty {
            <nz-empty nzNotFoundImage="simple" [nzNotFoundContent]="service.filter() ? 'אין כללים תואמים' : 'עדיין אין כללי התראה'" />
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host { display: block; padding: 14px 18px; }
    .page { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
    .header { display: flex; align-items: center; gap: 10px; }
    .page-title { display: inline-flex; gap: 6px; align-items: center; }
    .spacer { flex: 1; }
    .intro { margin: 0; font-size: 13px; }
    .filter { max-width: 360px; border-radius: 20px; }
    .list { list-style: none; margin: 0; padding: 0; background: #fff; border-radius: 12px; box-shadow: 0 2px 20px rgba(0,0,0,.08); overflow: hidden; }
    .item { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #f3f3f3; }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .desc { font-size: 13px; color: #666; }
    .channels { display: flex; gap: 4px; }
    .row-actions { display: flex; }
  `,
})
export class NotificationsSettingsComponent {
  readonly service = inject(NotificationsSettingsService);
  private readonly message = inject(NzMessageService);

  readonly filtered = computed(() => {
    const q = this.service.filter().trim();
    const rules = this.service.rules() ?? [];
    return q ? rules.filter((r) => r.name.includes(q) || describeRule(r).includes(q)) : rules;
  });

  constructor() {
    this.service.load();
  }

  remove(r: INotificationSettings) {
    this.service.delete(r._id!).subscribe(() => this.message.success('הכלל נמחק'));
  }
}
