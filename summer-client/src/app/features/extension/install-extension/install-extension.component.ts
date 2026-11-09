import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzStepsModule } from 'ng-zorro-antd/steps';
import { CRX_URL, ExtensionService } from '../extension.service';

/** /extension/install — one-click install, and the manual fallback when the browser policy isn't in place. */
@Component({
  selector: 'app-install-extension',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzStepsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './install-extension.component.html',
  styleUrl: './install-extension.component.scss',
})
export class InstallExtensionComponent {
  readonly crxUrl = CRX_URL;
  readonly info = inject(ExtensionService).info;
}
