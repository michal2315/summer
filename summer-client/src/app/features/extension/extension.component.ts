import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

/** /extension — what the companion browser extension does. */
@Component({
  selector: 'app-extension-details',
  imports: [RouterLink, NzButtonModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extension.component.html',
  styleUrl: './extension.component.scss',
})
export class ExtensionDetailsComponent {}
