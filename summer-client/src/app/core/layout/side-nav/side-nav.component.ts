import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { catchError, of } from 'rxjs';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { NotificationBellComponent } from '../../../shared/components/notification-bell/notification-bell.component';
import { WhatsNewService } from '../../../shared/components/whats-new';
import { PermissionService } from '../../../shared/services/permission.service';
import { UserService } from '../../auth/user.service';
import { NzModalService } from 'ng-zorro-antd/modal';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AltKeyId } from '../../../shared/keyboard/alt-keys';
import { TourService } from '../../../shared/tour/tour.service';

interface NavItem {
  label: string;
  icon: string;
  link: string[];
  altKey: AltKeyId;
}

@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive, NzIconModule, AvatarComponent, NotificationBellComponent, AltKeyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.scss',
})
export class SideNavComponent {
  private readonly users = inject(UserService);
  private readonly modal = inject(NzModalService);
  private readonly dashboardPermitted = toSignal(inject(PermissionService).dashboardAccess().pipe(catchError(() => of(false))), {
    initialValue: false,
  });

  readonly whatsNew = inject(WhatsNewService);
  readonly tour = inject(TourService);
  readonly navigate = output<void>();
  readonly user = this.users.user;

  /** Sunny team (helpdesk) popup; lazy-loaded so it stays out of the initial bundle. */
  async openHelpdesk() {
    const { HelpdeskModalComponent } = await import('../../../shared/components/helpdesk-modal/helpdesk-modal.component');
    this.modal.create({ nzTitle: 'צוות סאני', nzContent: HelpdeskModalComponent, nzFooter: null, nzWidth: 440 });
  }

  readonly items = computed<NavItem[]>(() => {
    const items: NavItem[] = [
      { label: 'דף הבית', icon: 'home', link: ['/summaries'], altKey: 'home' },
      { label: 'פרופיל', icon: 'user', link: ['/profile', this.users.userId() ?? ''], altKey: 'profile' },
      { label: 'התראות', icon: 'notification', link: ['/notifications'], altKey: 'notifications' },
      { label: 'כמוסות', icon: 'experiment', link: ['/capsules'], altKey: 'capsules' },
      { label: 'הרשאות', icon: 'lock', link: ['/permissions'], altKey: 'permissions' },
      { label: 'תוסף', icon: 'appstore-add', link: ['/extension'], altKey: 'extension' },
    ];
    if (this.dashboardPermitted()) items.push({ label: 'דשבורד', icon: 'dashboard', link: ['/dashboard'], altKey: 'dashboard' });
    return items;
  });
}
