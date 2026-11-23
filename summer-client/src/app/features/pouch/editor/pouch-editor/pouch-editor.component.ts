import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Editor } from '@tiptap/core';
import { ResolvedPos } from '@tiptap/pm/model';
import { IPouchPage, PouchDoc, PouchMode } from '../../../../shared/models';
import { ContentTypeService } from '../../../../shared/services/content-type.service';
import { PouchField, fieldLabel } from '../../pouch-fields';
import { PouchFieldSidebarComponent } from '../field-sidebar/field-sidebar.component';
import { PouchBlock } from '../../pouch-blocks';
import { BLOCK_DRAG_TYPE, FIELD_DRAG_TYPE, pouchExtensions, unwrapRepeat } from '../pouch-extensions';
import { PouchRibbonComponent } from '../ribbon/ribbon.component';

/** Just after the paragraph (or heading) holding a position; the position itself when it isn't in one. */
function afterTextblock($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).isTextblock) return $pos.after(d);
  return $pos.pos;
}

/** Zoom steps of the page, in percent. */
export const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

/**
 * The Pouch editor: a Word-like ribbon over an A4 page (Tiptap), with the fields sidebar beside it when editing a format.
 * Fields go in by clicking them in the sidebar (at the cursor) or dragging them onto the page; chips can be dragged
 * around the page too. The format editor and the export preview both use it (`fields` off in the preview).
 */
@Component({
  selector: 'app-pouch-editor',
  imports: [PouchRibbonComponent, PouchFieldSidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The page's content is Tiptap's DOM, outside Angular's templates: its styles are global, scoped under .pouch-editor.
  encapsulation: ViewEncapsulation.None,
  templateUrl: './pouch-editor.component.html',
  styleUrl: './pouch-editor.component.scss',
})
export class PouchEditorComponent implements OnDestroy {
  private readonly contentTypes = inject(ContentTypeService);

  /** The starting document; later changes are read with `json()`. */
  readonly doc = input.required<PouchDoc>();
  /** The format's mode: per summary keeps a repeat block in the document. */
  readonly mode = input<PouchMode>('perSummary');
  /** Show the fields sidebar (editing a format) — the export preview has none. */
  readonly fields = input(true);
  /** Off: view only (someone who may use the format but not edit it) — no ribbon, no sidebar, no typing. */
  readonly editable = input(true);
  readonly page = model<IPouchPage>({ orientation: 'portrait', margins: 'normal' });
  /** The document changed (typing, formatting, fields…). */
  readonly changed = output<void>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  readonly editor = signal<Editor | null>(null);
  /** Bumped on every editor transaction, so the ribbon re-reads the editor's state. */
  readonly tick = signal(0);
  readonly zoom = signal(100);
  readonly zoomFactor = computed(() => this.zoom() / 100);

  constructor() {
    afterNextRender(() => this.create());
  }

  private create() {
    const byId = this.contentTypes.fieldsById;
    const editor = new Editor({
      element: this.host().nativeElement,
      extensions: pouchExtensions({
        labelOf: (key) => fieldLabel(key, byId()),
        repeatRequired: () => this.fields() && this.mode() === 'perSummary',
      }),
      content: this.doc(),
      editable: this.editable(),
      editorProps: {
        attributes: { class: 'pouch-content', dir: 'rtl', 'aria-label': 'המסמך' },
        handleDrop: (view, event) => {
          const field = event.dataTransfer?.getData(FIELD_DRAG_TYPE);
          const block = event.dataTransfer?.getData(BLOCK_DRAG_TYPE);
          if (!field && !block) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos) return false;
          event.preventDefault();
          if (field) {
            const f = JSON.parse(field) as PouchField;
            this.editor()?.chain().focus().insertContentAt(pos.pos, { type: 'field', attrs: { key: f.key, label: f.label } }).run();
          } else {
            // A block goes after the paragraph it was dropped on, not into the middle of it.
            this.editor()?.chain().focus().insertContentAt(afterTextblock(view.state.doc.resolve(pos.pos)), JSON.parse(block!)).run();
          }
          return true;
        },
      },
      onTransaction: ({ transaction }) => {
        this.tick.update((n) => n + 1);
        if (transaction.docChanged) this.changed.emit();
      },
    });
    this.editor.set(editor);
  }

  ngOnDestroy() {
    this.editor()?.destroy();
  }

  /** The current document. */
  json(): PouchDoc {
    return (this.editor()?.getJSON() as PouchDoc | undefined) ?? this.doc();
  }

  /** Put a field at the cursor. */
  insertField(f: PouchField) {
    this.editor()?.chain().focus().insertContent({ type: 'field', attrs: { key: f.key, label: f.label } }).run();
  }

  /** Put a ready-made block after the cursor's paragraph. */
  insertBlock(b: PouchBlock) {
    const editor = this.editor();
    if (!editor) return;
    editor.chain().focus().insertContentAt(afterTextblock(editor.state.selection.$from), b.content).run();
  }

  /**
   * Switch the document to a mode: combined unwraps the repeat block into the page; per summary wraps the whole page
   * into one (with an empty start and end around it), since what was written for "all" usually describes one summary.
   * Called by the format editor *after* its mode changed.
   */
  applyMode(mode: PouchMode) {
    const editor = this.editor();
    if (!editor) return;
    const { state } = editor;
    const tr = state.tr;
    const found = unwrapRepeat(state.doc);
    if (mode === 'combined') {
      if (!found) return;
      tr.replaceWith(found.from, found.to, found.content);
    } else {
      if (found) return;
      const { paragraph, repeatBlock } = state.schema.nodes;
      const inner = state.doc.content.size ? state.doc.content : paragraph.create();
      tr.replaceWith(0, state.doc.content.size, [paragraph.create(), repeatBlock.create(null, inner), paragraph.create()]);
    }
    editor.view.dispatch(tr);
  }

  /** A click on the grey around the page puts the cursor at the end, as in Word. */
  focusEnd(event: MouseEvent) {
    if (event.target === event.currentTarget) this.editor()?.commands.focus('end');
  }
}
