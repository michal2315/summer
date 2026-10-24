import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { INotification } from '../models';
import { RelativeTimePipe } from '../pipes/pipes';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-notification-bell',
  imports: [NzBadgeModule, NzButtonModule, NzIconModule, NzPopoverModule, NzEmptyModule, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nz-badge [nzCount]="service.unread()" [nzOverflowCount]="99" nzSize="small">
      <button
        type="button"
        nz-button
        nzType="text"
        nzShape="circle"
        nz-popover
        nzPopoverTrigger="click"
        nzPopoverPlacement="bottomLeft"
        [nzPopoverTitle]="title"
        [nzPopoverContent]="list"
        [(nzPopoverVisible)]="open"
        aria-label="התראות"
      >
        <span nz-icon nzType="bell" class="bell"></span>
      </button>
    </nz-badge>

    <ng-template #title>
      <div class="head">
        <span>התראות</span>
        @if (service.unread()) {
          <button type="button" nz-button nzType="link" nzSize="small" (click)="service.markAllViewed()">סמן הכל כנקרא</button>
        }
      </div>
    </ng-template>
    <ng-template #list>
      <ul class="rows">
        @for (n of service.items(); track n._id) {
          <li>
            <button type="button" class="row" [class.unread]="!n.isViewed" (click)="openNotification(n)">
              <span class="text">{{ n.text }}</span>
              <span class="time">{{ n.creationDate | relativeTime }}</span>
            </button>
          </li>
        } @empty {
          <nz-empty nzNotFoundContent="אין התראות חדשות" />
        }
      </ul>
    </ng-template>
  `,
  styles: `
    .bell { font-size: 20px; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
    .rows { list-style: none; margin: 0; padding: 0; width: 320px; max-height: 420px; overflow: auto; }
    .row { all: unset; box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px; border-radius: 8px; cursor: pointer; }
    .row:hover, .row:focus-visible { background: #f7f7f7; }
    .row.unread { background: #fff4f5; }
    .row.unread .text { font-weight: 700; }
    .time { font-size: 12px; color: #9b9bb1; }
  `,
})
export class NotificationBellComponent {
  readonly service = inject(NotificationService);
  private readonly router = inject(Router);
  readonly open = signal(false);

  constructor() {
    this.service.start();
  }

  openNotification(n: INotification) {
    if (!n.isViewed) this.service.markViewed(n._id);
    this.open.set(false);
    if (n.summaryId) this.router.navigate(['/summaries'], { queryParams: { summaryId: n.summaryId } });
  }
}
