import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ISummary } from '../../../shared/models';
import { DateFormatPipe, PlainTextPipe } from '../../../shared/pipes/pipes';

/** Dashboard mini card: author, title, preview, permission dots, comment count. */
@Component({
  selector: 'app-summary-cube',
  imports: [RouterLink, NzIconModule, NzToolTipModule, AvatarComponent, DateFormatPipe, PlainTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-cube.component.html',
  styleUrl: './summary-cube.component.scss',
})
export class SummaryCubeComponent {
  readonly summary = input.required<ISummary>();
}
