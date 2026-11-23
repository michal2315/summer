import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { ContentTypeService } from '../../../../shared/services/content-type.service';
import { PouchField, PouchFieldGroup, fieldGroups } from '../../pouch-fields';
import { POUCH_BLOCKS, PouchBlock } from '../../pouch-blocks';
import { BLOCK_DRAG_TYPE, FIELD_DRAG_TYPE } from '../pouch-extensions';

const searchKey = (s: string) => s.toLowerCase();

/**
 * Ready-made blocks (a title with details, a details table, a timeline…) and the fields a format can place, by section: the common fields (always open), then one collapsible section per intel
 * type and one with every custom field. Searching narrows every section and opens those with matches. A field goes in
 * at the cursor on click, or where it's dropped on the page.
 */
@Component({
  selector: 'app-pouch-field-sidebar',
  imports: [FormsModule, NzIconModule, NzInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './field-sidebar.component.html',
  styleUrl: './field-sidebar.component.scss',
})
export class PouchFieldSidebarComponent {
  private readonly contentTypes = inject(ContentTypeService);

  readonly pick = output<PouchField>();
  readonly pickBlock = output<PouchBlock>();

  readonly blocks = POUCH_BLOCKS;
  readonly blocksOpen = signal(true);

  readonly text = signal('');
  /** Sections opened by hand (the common one is always open). */
  readonly open = signal(new Set<string>());

  private readonly groups = computed(() => fieldGroups(this.contentTypes.list(), this.contentTypes.fields()));

  readonly shown = computed<(PouchFieldGroup & { expanded: boolean; total: number })[]>(() => {
    const q = searchKey(this.text().trim());
    const open = this.open();
    return this.groups()
      .map((g) => {
        const fields = q ? g.fields.filter((f) => searchKey(f.label).includes(q)) : g.fields;
        return { ...g, fields, total: g.fields.length, expanded: g.id === 'core' || !!q || open.has(g.id) };
      })
      .filter((g) => !q || g.fields.length);
  });

  toggle(id: string) {
    this.open.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  blockDragStart(event: DragEvent, b: PouchBlock) {
    event.dataTransfer?.setData(BLOCK_DRAG_TYPE, JSON.stringify(b.content));
    event.dataTransfer?.setData('text/plain', b.label);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  dragStart(event: DragEvent, f: PouchField) {
    event.dataTransfer?.setData(FIELD_DRAG_TYPE, JSON.stringify({ key: f.key, label: f.label }));
    event.dataTransfer?.setData('text/plain', `«${f.label}»`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }
}
