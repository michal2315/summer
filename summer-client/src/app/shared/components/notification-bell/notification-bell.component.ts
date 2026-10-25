import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { INotification } from '../../models';
import { RelativeTimePipe } from '../../pipes/pipes';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-notification-bell',
  imports: [NzBadgeModule, NzButtonModule, NzIconModule, NzPopoverModule, NzEmptyModule, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notification-bell.component.html',
  styleUrl: './notification-bell.component.scss',
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
