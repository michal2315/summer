import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { PreferencesModalComponent } from './preferences-modal.component';

/** The gear beside the notifications bell: opens the preferences dialog in the middle of the screen. */
@Component({
  selector: 'app-preferences-button',
  imports: [NzButtonModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences-button.component.html',
  styleUrl: './preferences-button.component.scss',
})
export class PreferencesButtonComponent {
  private readonly modal = inject(NzModalService);

  open() {
    this.modal.create({ nzTitle: 'העדפות', nzContent: PreferencesModalComponent, nzFooter: null, nzCentered: true, nzWidth: 560 });
  }
}
