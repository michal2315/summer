import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { InViewDirective } from '../../../shared/components/in-view.directive';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { INotificationSettings } from '../../../shared/models';
import { renderPages } from '../../../shared/utils/render-pages';
import { NotificationNamePipe, NotificationsSettingsService, describeRule } from '../notification-rules';

/** /notifications — the user's e-mail switches, and notification rules admin: list, filter, edit, delete. */
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
    NzSwitchModule,
    NzTagModule,
    InViewDirective,
    NotificationBellComponent,
    SkeletonComponent,
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
  /** Rendered a page at a time; a new filter starts over. */
  readonly page = renderPages(this.filtered, 30, this.service.filter);

  constructor() {
    this.service.load();
    this.service.loadPreferences();
  }

  remove(r: INotificationSettings) {
    this.service.delete(r._id!).subscribe(() => this.message.success('הכלל נמחק'));
  }
}
