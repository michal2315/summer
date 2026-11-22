import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { CRX_URL, ExtensionService } from '../../../features/extension/extension.service';
import { FolderTreeComponent } from '../../../features/hierarchy/folder-tree/folder-tree.component';
import { FolderTreeStore } from '../../../features/hierarchy/folder-tree.store';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { TourService } from '../../../shared/tour/tour.service';
import { UserService } from '../../auth/user.service';

/** Logo, profile card, the folder tree (with the staging link while there are old collections to sort), and tour / helpdesk at the bottom. */
@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive, NzIconModule, AvatarComponent, AltKeyDirective, FolderTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.scss',
})
export class SideNavComponent {
  private readonly modal = inject(NzModalService);

  readonly tour = inject(TourService);
  /** The extension link shows once the server reports a published package; following it opens the browser's install dialog. */
  readonly extension = inject(ExtensionService);
  readonly crxUrl = CRX_URL;
  readonly navigate = output<void>();
  readonly user = inject(UserService).user;
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderTreeStore);
  /** Collections from the old Summer you manage that still wait in the legacy root (0: no link). */
  readonly toSort = computed(() => {
    const me = this.users.userId() ?? '';
    return this.folders.folders().filter((f) => f.legacy === 'collection' && f.managers.includes(me)).length;
  });

  /** Sunny team (helpdesk) popup; lazy-loaded so it stays out of the initial bundle. */
  async openHelpdesk() {
    const { HelpdeskModalComponent } = await import('../../../shared/components/helpdesk-modal/helpdesk-modal.component');
    this.modal.create({ nzTitle: 'צוות סאני', nzContent: HelpdeskModalComponent, nzFooter: null, nzWidth: 440 });
  }
}
