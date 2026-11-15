import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalRef } from 'ng-zorro-antd/modal';
import { SummyComponent } from '../../easter-eggs/summy/summy.component';
import { RichHtmlPipe } from '../../pipes/pipes';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { Release, WhatsNewService } from '../whats-new';

/** Release notes: the newest release in full under a banner, older ones folded below. */
@Component({
  selector: 'app-whats-new-modal',
  imports: [NzButtonModule, NzIconModule, SkeletonComponent, SummyComponent, RichHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whats-new-modal.component.html',
  styleUrl: './whats-new-modal.component.scss',
})
export class WhatsNewModalComponent {
  private readonly service = inject(WhatsNewService);
  private readonly ref = inject(NzModalRef);
  readonly releases = signal<Release[] | null>(null);
  readonly latest = computed(() => this.releases()?.[0] ?? null);
  readonly older = computed(() => this.releases()?.slice(1) ?? []);
  /** The older release that is unfolded, if any. */
  readonly opened = signal<string | null>(null);

  constructor() {
    this.service.releases().subscribe((list) => this.releases.set(list));
  }

  day(iso: string) {
    return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  toggle(version: string) {
    this.opened.update((v) => (v === version ? null : version));
  }

  close() {
    for (const r of this.releases() ?? []) if (!r.isAcknowledged) this.service.acknowledge(r.version).subscribe();
    this.ref.close();
  }
}
