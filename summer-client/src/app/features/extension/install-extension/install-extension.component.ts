import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzStepsModule } from 'ng-zorro-antd/steps';

/** /extension/install — step-by-step install guide. */
@Component({
  selector: 'app-install-extension',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzStepsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './install-extension.component.html',
  styleUrl: './install-extension.component.scss',
})
export class InstallExtensionComponent {}
