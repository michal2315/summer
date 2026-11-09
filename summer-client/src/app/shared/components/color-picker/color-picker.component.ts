import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SUMMARY_COLORS, colorGlow } from '../../models/colors';

/** Color dot + 8-swatch popover. '' = uncolored ("לא נבחר צבע"). */
@Component({
  selector: 'app-color-picker',
  imports: [NzPopoverModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-picker.component.html',
  styleUrl: './color-picker.component.scss',
})
export class ColorPickerComponent {
  readonly color = input<string>('');
  readonly colorChange = output<string>();
  readonly colors = SUMMARY_COLORS;
  readonly glow = colorGlow;
  open = signal(false);

  pick(c: string) {
    this.open.set(false);
    if (c !== this.color()) this.colorChange.emit(c);
  }
}
