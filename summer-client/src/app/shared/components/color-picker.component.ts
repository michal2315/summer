import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { SUMMARY_COLORS, colorGlow } from '../models/colors';

/** Color dot + 8-swatch popover. '' = uncolored ("לא נבחר צבע"). */
@Component({
  selector: 'app-color-picker',
  imports: [NzPopoverModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="dot"
      [class.empty]="!color()"
      [style.background]="color() || null"
      [style.box-shadow]="glow(color())"
      nz-popover
      nzPopoverTrigger="click"
      [nzPopoverContent]="palette"
      [(nzPopoverVisible)]="open"
      [nz-tooltip]="color() ? null : 'לא נבחר צבע'"
      (click)="$event.stopPropagation()"
      aria-label="בחירת צבע"
    ></button>
    <ng-template #palette>
      <div class="palette" role="listbox" aria-label="צבעים">
        @for (c of colors; track c) {
          <button type="button" class="swatch" [style.background]="c" [class.selected]="c === color()" (click)="pick(c)" [attr.aria-label]="c"></button>
        }
        <button type="button" class="swatch none" [class.selected]="!color()" (click)="pick('')" aria-label="ללא צבע">✕</button>
      </div>
    </ng-template>
  `,
  styles: `
    :host { display: inline-flex; }
    .dot { width: 16px; height: 16px; border-radius: 50%; border: none; cursor: pointer; padding: 0; }
    .dot.empty { border: 2px dashed #9b9bb1; background: transparent; }
    .palette { display: grid; grid-template-columns: repeat(3, 24px); gap: 8px; }
    .swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
    .swatch.selected { border-color: #05043d; }
    .swatch.none { background: #fff; border: 1px solid #ccc; color: #9b9bb1; font-size: 11px; }
  `,
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
