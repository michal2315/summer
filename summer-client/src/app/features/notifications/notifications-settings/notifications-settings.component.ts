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
import { INotificationSettings } from '../../../shared/models';
import { NotificationNamePipe, NotificationsSettingsService, describeRule } from '../notification-rules';

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
    NotificationNamePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notifications-settings.component.html',
  styleUrl: './notifications-settings.component.scss',
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
