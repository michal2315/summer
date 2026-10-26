import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ICollection } from '../../../shared/models';
import { DateFormatPipe, RelativeTimePipe } from '../../../shared/pipes/pipes';

/** A collection rendered with the same structure and styles as a summary card (styles/_card.scss). */
@Component({
  selector: 'app-collection-card',
  imports: [RouterLink, NzIconModule, NzTagModule, NzToolTipModule, AvatarComponent, DateFormatPipe, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.active]': 'active()',
    '[style.--stripe]': 'stripe()',
  },
  templateUrl: './collection-card.component.html',
  styleUrl: './collection-card.component.scss',
})
export class CollectionCardComponent {
  readonly collection = input.required<ICollection>();
  readonly active = input(false);
  readonly pinned = input(false);
  readonly favorite = input(false);

  readonly selected = output<ICollection>();
  readonly opened = output<ICollection>();
  readonly pinToggle = output<ICollection>();
  readonly favoriteToggle = output<ICollection>();

  /** Side stripe uses the first permission group's color, like a summary's color stripe. */
  readonly stripe = computed(() => this.collection().permissions[0]?.color ?? 'transparent');
  readonly preview = computed(() => {
    const c = this.collection();
    const n = c.summaries.length;
    const count = n === 0 ? 'אין עדיין תמציות בלקט' : n === 1 ? 'תמצית אחת בלקט' : `${n} תמציות בלקט`;
    const access = c.permissions.length ? `גלוי ל: ${c.permissions.map((p) => p.name).join(', ')}` : 'גלוי לכולם';
    return `${count}. ${access}.`;
  });
}
