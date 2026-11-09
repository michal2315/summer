import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { IFolder } from '../../../shared/models';

/** Keep in sync with the grid in the stylesheet. */
const CARD_MIN = 170;
const GAP = 8;
/** Rows shown before "show more". */
const ROWS = 2;

/** The selected folder's direct subfolders as cards (name + summary count), two rows until expanded. */
@Component({
  selector: 'app-folder-cards',
  imports: [RouterLink, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './folder-cards.component.html',
  styleUrl: './folder-cards.component.scss',
})
export class FolderCardsComponent {
  readonly folders = input.required<IFolder[]>();
  /** Folder id → summaries in it and its subfolders. */
  readonly totals = input.required<Map<string, number>>();

  readonly expanded = signal(false);
  /** Cards per row at the current width (the grid auto-fills, so this mirrors it). */
  private readonly columns = signal(1);
  private readonly limit = computed(() => this.columns() * ROWS);
  readonly shown = computed(() => (this.expanded() ? this.folders() : this.folders().slice(0, this.limit())));
  readonly hiddenCount = computed(() => this.folders().length - this.limit());

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const observer = new ResizeObserver(([entry]) =>
      this.columns.set(Math.max(1, Math.floor((entry.contentRect.width + GAP) / (CARD_MIN + GAP)))),
    );
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
    // Another folder's subfolders start collapsed again.
    effect(() => {
      this.folders();
      this.expanded.set(false);
    });
  }
}
