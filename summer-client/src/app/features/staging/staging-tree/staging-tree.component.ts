import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { UserService } from '../../../core/auth/user.service';
import { IFolder } from '../../../shared/models';
import { highlightText, searchRegex } from '../../../shared/pipes/highlight';
import type { FolderEditorData } from '../../hierarchy/folder-editor-modal/folder-editor-modal.component';
import { FolderTreeStore } from '../../hierarchy/folder-tree.store';

/** The tree's "without folder" target: summaries go out of their collection without going into a folder. */
export const NO_FOLDER_TARGET = 'none';

/** Hovering a closed folder this long while dragging opens it. */
const DRAG_EXPAND_MS = 700;

/**
 * The staging page's folder tree (the new hierarchy, without the legacy root): pick the folder things go to, or drop
 * them on it. Only folders you manage can take things; the others show so you can reach their subfolders.
 */
@Component({
  selector: 'app-staging-tree',
  imports: [NgTemplateOutlet, NzIconModule, NzPopconfirmModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staging-tree.component.html',
  styleUrl: './staging-tree.component.scss',
})
export class StagingTreeComponent {
  readonly store = inject(FolderTreeStore);
  private readonly users = inject(UserService);
  private readonly modal = inject(NzModalService);

  /** The folder picked as where things go (or NO_FOLDER_TARGET). */
  readonly target = model<string | null>(null);
  /** What is being dragged from the collections: folders you manage take both, "without folder" only summaries. */
  readonly dragging = input<'items' | 'collection' | null>(null);
  readonly NO_FOLDER_TARGET = NO_FOLDER_TARGET;
  /** A folder that just received something (briefly highlighted). */
  readonly landed = input<string | null>(null);
  /** Something was dropped on this folder. */
  readonly dropped = output<string>();
  /** How many summaries are picked: clicking a folder then asks (a small confirm) to move them there. */
  readonly pending = input(0);
  /** The move into this folder (or NO_FOLDER_TARGET) was confirmed. */
  readonly chosen = output<string>();

  readonly expanded = signal(new Set<string>());
  readonly dropOver = signal<string | null>(null);
  private hoverTimer?: ReturnType<typeof setTimeout>;
  private hoverId: string | null = null;

  // ---- search: folder names ----
  readonly query = signal('');
  readonly term = computed(() => this.query().trim().toLowerCase());
  private readonly searchRe = computed(() => searchRegex(this.term()));
  /** While searching: matching folders and their ancestors; null = all. */
  readonly visible = computed(() => {
    const term = this.term();
    if (!term) return null;
    const byId = this.store.byId();
    const show = new Set<string>();
    for (const f of this.store.folders())
      if (!f.legacy && f.name.toLowerCase().includes(term))
        for (let c: IFolder | undefined = f; c && !show.has(c._id); c = c.parentId ? byId.get(c.parentId) : undefined) show.add(c._id);
    return show;
  });

  /** Folders under `parent` (null = top level), never the legacy root. */
  childFolders(parent: string | null): IFolder[] {
    const list = (this.store.children().get(parent) ?? []).filter((f) => !f.legacy);
    const visible = this.visible();
    return visible ? list.filter((f) => visible.has(f._id)) : list;
  }

  hasChildren(f: IFolder): boolean {
    return this.childFolders(f._id).length > 0;
  }

  mark(name: string) {
    return highlightText(name, this.searchRe());
  }

  isManager(f: IFolder): boolean {
    return f.managers.includes(this.users.userId() ?? '');
  }

  /** Things can go into folders you manage. */
  canTake(f: IFolder): boolean {
    return this.isManager(f) && !f.legacy;
  }

  toggle(id: string) {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  private expand(id: string) {
    if (!this.expanded().has(id)) this.expanded.update((s) => new Set(s).add(id));
  }

  /** Open the folder's ancestors so it shows. */
  reveal(id: string) {
    const byId = this.store.byId();
    for (let f = byId.get(byId.get(id)?.parentId ?? ''); f; f = f.parentId ? byId.get(f.parentId) : undefined) this.expand(f._id);
  }

  /** A click on a row: pick it as the target (again: unpick). A folder you don't manage just opens. */
  pick(f: IFolder) {
    if (!this.canTake(f)) {
      if (this.hasChildren(f)) this.toggle(f._id);
      return;
    }
    this.target.set(this.target() === f._id ? null : f._id);
  }

  /** The confirm's question for moving the picked summaries into `name`. */
  question(name: string | null): string {
    const n = this.pending();
    const what = n === 1 ? 'התמצית שנבחרה' : `${n} התמציות שנבחרו`;
    return name ? `להעביר את ${what} אל "${name}"?` : `להוציא את ${what} מהלקט, בלי תיקייה?`;
  }

  /** A click on a folder (after the confirm, when summaries are picked): move them there, or just pick it as target. */
  choose(f: IFolder) {
    if (this.pending() && this.canTake(f)) {
      this.target.set(f._id);
      this.chosen.emit(f._id);
    } else this.pick(f);
  }

  chooseNoFolder() {
    if (this.pending()) this.chosen.emit(NO_FOLDER_TARGET);
    else this.pickNoFolder();
  }

  pickNoFolder() {
    this.target.set(this.target() === NO_FOLDER_TARGET ? null : NO_FOLDER_TARGET);
  }

  onNoFolderDragOver(e: DragEvent) {
    if (this.dragging() !== 'items') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.dropOver.set(NO_FOLDER_TARGET);
  }

  onNoFolderDrop(e: DragEvent) {
    e.preventDefault();
    const ok = this.dragging() === 'items';
    this.endDrag();
    if (ok) this.dropped.emit(NO_FOLDER_TARGET);
  }

  collapseAll() {
    this.expanded.set(new Set());
  }

  onDragOver(e: DragEvent, f: IFolder) {
    if (!this.dragging() || !this.canTake(f)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    this.dropOver.set(f._id);
    if (f._id !== this.hoverId) {
      clearTimeout(this.hoverTimer);
      this.hoverId = f._id;
      this.hoverTimer = setTimeout(() => this.expand(f._id), DRAG_EXPAND_MS);
    }
  }

  onDragLeave(e: DragEvent) {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
    this.endDrag();
  }

  onDrop(e: DragEvent, f: IFolder) {
    e.preventDefault();
    e.stopPropagation();
    this.endDrag();
    if (this.canTake(f)) this.dropped.emit(f._id);
  }

  private endDrag() {
    this.dropOver.set(null);
    clearTimeout(this.hoverTimer);
    this.hoverId = null;
  }

  /** A new folder (top level, or inside `parent`); it becomes the target. */
  async create(parent: IFolder | null) {
    const { FolderEditorModalComponent } = await import('../../hierarchy/folder-editor-modal/folder-editor-modal.component');
    this.modal
      .create<InstanceType<typeof FolderEditorModalComponent>, FolderEditorData, IFolder>({
        nzTitle: parent ? `תיקיית משנה ב"${parent.name}"` : 'תיקייה חדשה',
        nzContent: FolderEditorModalComponent,
        nzData: { parentId: parent?._id ?? null, folders: this.store.folders() },
        nzFooter: null,
        nzWidth: 480,
      })
      .afterClose.subscribe((created) => {
        if (!created) return;
        if (created.parentId) {
          this.expand(created.parentId);
          this.reveal(created.parentId);
        }
        this.target.set(created._id);
      });
  }
}
