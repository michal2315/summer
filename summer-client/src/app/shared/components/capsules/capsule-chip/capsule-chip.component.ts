import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { ICapsule } from '../../../models';
import { CapsuleService } from '../../../services/capsule.service';
import { CapsuleWordsComponent } from '../capsule-words/capsule-words.component';

/** A capsule as a chip: name and word count; a click shows its words. Fetches the capsule itself when given only an id. */
@Component({
  selector: 'app-capsule-chip',
  imports: [NzIconModule, NzPopoverModule, CapsuleWordsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsule-chip.component.html',
  styleUrl: './capsule-chip.component.scss',
  host: { '[class.sm]': "size() === 'sm'" },
})
export class CapsuleChipComponent {
  private readonly capsules = inject(CapsuleService);

  readonly capsuleId = input<string>();
  readonly capsule = input<ICapsule>();
  readonly removable = input(false);
  readonly size = input<'sm' | 'md'>('md');
  readonly removed = output<void>();

  readonly resolved = computed(() => this.capsule() ?? (this.capsuleId() ? this.capsules.byId(this.capsuleId()!) : undefined));

  constructor() {
    effect(() => {
      const id = this.capsuleId();
      if (id && !this.capsule()) this.capsules.ensure({ ids: [id] });
    });
  }

  remove(e: Event) {
    e.stopPropagation();
    this.removed.emit();
  }
}
