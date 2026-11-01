import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { CRX_URL, ExtensionService } from './extension.service';

/** /extension — what the companion browser extension does, and the one-click install. */
@Component({
  selector: 'app-extension-details',
  imports: [RouterLink, NzButtonModule, NzIconModule, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './extension.component.html',
  styleUrl: './extension.component.scss',
})
export class ExtensionDetailsComponent {
  readonly crxUrl = CRX_URL;
  readonly info = inject(ExtensionService).info;
}
