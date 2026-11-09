import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzModalRef } from 'ng-zorro-antd/modal';
import { RichHtmlPipe } from '../../pipes/pipes';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { Release, WhatsNewService } from '../whats-new';

@Component({
  selector: 'app-whats-new-modal',
  imports: [NzButtonModule, NzCollapseModule, SkeletonComponent, RichHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whats-new-modal.component.html',
  styleUrl: './whats-new-modal.component.scss',
})
export class WhatsNewModalComponent {
  private readonly service = inject(WhatsNewService);
  private readonly ref = inject(NzModalRef);
  readonly releases = signal<Release[] | null>(null);

  constructor() {
    this.service.releases().subscribe((list) => this.releases.set(list));
  }

  close() {
    for (const r of this.releases() ?? []) if (!r.isAcknowledged) this.service.acknowledge(r.version).subscribe();
    this.ref.close();
  }
}
