import { Extension, Extensions, Node, mergeAttributes } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Image from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { DOMOutputSpec, Fragment, Node as PmNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';

/** Where the sidebar puts a field key on a drag. */
export const FIELD_DRAG_TYPE = 'application/x-summer-pouch-field';
/** …and a ready-made block's content (JSON). */
export const BLOCK_DRAG_TYPE = 'application/x-summer-pouch-block';

/**
 * A field placeholder: an inline chip that an export replaces with each summary's value. It keeps the key (what to fill)
 * and the label at the time it was placed (shown if the field is later renamed away or deleted). Chips can carry marks,
 * so a bold red chip fills in bold red.
 */
export const FieldNode = Node.create<{ labelOf: (key: string) => string | undefined }>({
  name: 'field',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { labelOf: () => undefined };
  },

  addAttributes() {
    return {
      key: { default: '', parseHTML: (el) => el.getAttribute('data-key') ?? '', renderHTML: (a) => ({ 'data-key': a['key'] }) },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? '', renderHTML: (a) => ({ 'data-label': a['label'] }) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-pouch-field]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = this.options.labelOf(node.attrs['key']) ?? node.attrs['label'] ?? node.attrs['key'];
    return ['span', mergeAttributes(HTMLAttributes, { 'data-pouch-field': '', class: 'pouch-chip', contenteditable: 'false' }), label];
  },

  renderText({ node }) {
    return `«${this.options.labelOf(node.attrs['key']) ?? node.attrs['label']}»`;
  },
});

/** The part of a per-summary format that repeats once for each summary (at most one, at the top level). */
export const RepeatBlock = Node.create({
  name: 'repeatBlock',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-pouch-repeat]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-pouch-repeat': '', class: 'pouch-repeat' }), 0];
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'pouch-page-break' })];
  },
});

/**
 * A timeline of all the exported summaries, by event date: filled in as a date / summary table. `detail` says whether
 * each entry shows its title only or also the start of its content. In the editor it shows a sample.
 */
export const Timeline = Node.create({
  name: 'timeline',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      detail: { default: 'title', parseHTML: (el) => el.getAttribute('data-detail') ?? 'title', renderHTML: (a) => ({ 'data-detail': a['detail'] }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-pouch-timeline]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const withContent = node.attrs['detail'] === 'content';
    const row = (date: string, title: string): DOMOutputSpec => [
      'div',
      { class: 'tl-row' },
      ['span', { class: 'tl-date' }, date],
      ['span', { class: 'tl-dot' }],
      ['span', { class: 'tl-text' }, ['span', { class: 'tl-title' }, title], ...(withContent ? [['span', { class: 'tl-body' }, 'תחילת התוכן של התמצית…'] as DOMOutputSpec] : [])],
    ];
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-pouch-timeline': '', class: 'pouch-timeline', contenteditable: 'false' }),
      ['div', { class: 'tl-head' }, withContent ? 'ציר זמן · כל התמציות לפי תאריך, עם תוכן' : 'ציר זמן · כל התמציות לפי תאריך'],
      row('03/01', 'כותרת התמצית הראשונה'),
      row('14/02', 'כותרת התמצית השנייה'),
      row('27/03', 'כותרת התמצית השלישית'),
    ];
  },
});

/** The block under the pointer that can be moved: a child of the page or of the repeat block (never a table cell's). */
function movableBlockAt(view: EditorView, x: number, y: number): number | null {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const { doc } = view.state;
  const isContainer = (name: string) => name === 'doc' || name === 'repeatBlock';
  if (hit.inside >= 0) {
    const node = doc.nodeAt(hit.inside);
    if (node?.isBlock && isContainer(doc.resolve(hit.inside).parent.type.name)) return hit.inside;
  }
  const $pos = doc.resolve(hit.pos);
  for (let d = $pos.depth; d > 0; d--) if (isContainer($pos.node(d - 1).type.name)) return $pos.before(d);
  return null;
}

const handleKey = new PluginKey('pouchBlockHandle');

/**
 * A grip beside the block under the pointer (in the page's right margin); drag it to move the block — a paragraph, a
 * table, an image, the whole repeat block…
 */
const BlockHandle = Extension.create({
  name: 'blockHandle',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: handleKey,
        view: (view) => {
          const handle = document.createElement('div');
          handle.className = 'pouch-block-handle';
          handle.draggable = true;
          handle.contentEditable = 'false';
          handle.title = 'גרירה להזזת הבלוק';
          handle.textContent = '⋮⋮';
          const host = view.dom.parentElement!;
          host.appendChild(handle);
          let current: number | null = null;

          const hide = () => {
            handle.classList.remove('shown');
            current = null;
          };
          const onMove = (e: MouseEvent) => {
            if (e.target === handle) return;
            const pos = movableBlockAt(view, e.clientX, e.clientY);
            const dom = pos === null ? null : (view.nodeDOM(pos) as HTMLElement | null);
            if (pos === null || !dom?.getBoundingClientRect) return hide();
            const r = dom.getBoundingClientRect();
            const h = host.getBoundingClientRect();
            // The page may be zoomed: position in its own (unzoomed) pixels.
            const zoom = h.width / host.offsetWidth || 1;
            handle.style.top = `${(r.top - h.top) / zoom + 2}px`;
            handle.style.right = `${(h.right - r.right) / zoom - 26}px`;
            handle.classList.add('shown');
            current = pos;
          };
          const onDragStart = (e: DragEvent) => {
            if (current === null || !e.dataTransfer) return;
            const sel = NodeSelection.create(view.state.doc, current);
            view.dispatch(view.state.tr.setSelection(sel));
            // ProseMirror's own drop handler moves `dragging.slice` and deletes the original.
            view.dragging = { slice: sel.content(), move: true };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', sel.node.textContent || ' ');
            const dom = view.nodeDOM(current) as HTMLElement | null;
            if (dom) e.dataTransfer.setDragImage(dom, dom.offsetWidth, 0);
          };
          host.addEventListener('mousemove', onMove);
          host.addEventListener('mouseleave', hide);
          handle.addEventListener('dragstart', onDragStart);
          handle.addEventListener('dragend', hide);
          return {
            destroy: () => {
              host.removeEventListener('mousemove', onMove);
              host.removeEventListener('mouseleave', hide);
              handle.remove();
            },
          };
        },
      }),
    ];
  },
});

/** Blocks that can run left-to-right on the right-to-left page (and the Word file). */
export const DIRECTION_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'];

/**
 * Text direction per block, as Word's right-to-left / left-to-right buttons: `dir` is null on the page's own
 * direction (right-to-left), 'ltr' for English and the like. Lists and quotes carry it too, so their bullets and
 * indents switch sides with the text.
 */
const Direction = Extension.create({
  name: 'pouchDirection',
  addGlobalAttributes() {
    return [
      {
        types: DIRECTION_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => (el.getAttribute('dir') === 'ltr' ? 'ltr' : null),
            renderHTML: (a) => (a['dir'] === 'ltr' ? { dir: 'ltr' } : {}),
          },
        },
      },
    ];
  },
});

/** Cells can be shaded; the Word export uses the same colour. */
const cellBackground = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.getAttribute('data-background') || null,
    renderHTML: (a: Record<string, unknown>) => (a['backgroundColor'] ? { style: `background-color: ${a['backgroundColor']}` } : {}),
  },
};
const ShadedCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});
const ShadedHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellBackground };
  },
});

const repeatKey = new PluginKey('pouchRepeat');

/**
 * While a format repeats per summary, its document always has exactly one repeat block with somewhere to type before it:
 * deleting the block (say, select-all and delete) brings back an empty one where it was.
 */
const RepeatGuard = Extension.create<{ required: () => boolean }>({
  name: 'repeatGuard',
  addOptions() {
    return { required: () => false };
  },
  addProseMirrorPlugins() {
    const required = this.options.required;
    return [
      new Plugin({
        key: repeatKey,
        appendTransaction: (trs, _old, state) => {
          if (!required() || !trs.some((t) => t.docChanged)) return null;
          const { doc, schema } = state;
          const repeat = schema.nodes['repeatBlock'];
          const paragraph = schema.nodes['paragraph'];
          let index = -1;
          doc.forEach((n, _o, i) => n.type === repeat && (index = i));
          const tr = state.tr;
          if (index < 0) {
            // Put it back after the block holding the cursor.
            const at = Math.min(state.selection.$from.index(0) + 1, doc.childCount);
            let pos = 0;
            for (let i = 0; i < at; i++) pos += doc.child(i).nodeSize;
            tr.insert(pos, repeat.create(null, paragraph.create()));
            index = at;
          }
          if (index === 0) tr.insert(0, paragraph.create());
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});

export interface PouchExtensionOptions {
  labelOf: (key: string) => string | undefined;
  /** Per-summary mode: keep the repeat block. */
  repeatRequired: () => boolean;
  placeholder?: string;
}

/** The editor schema shared by the format editor and the export preview (and mirrored by the server's Word renderer). */
export function pouchExtensions(o: PouchExtensionOptions): Extensions {
  return [
    Document.extend({ content: 'block* repeatBlock? block*' }),
    StarterKit.configure({
      document: false,
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    TextStyleKit.configure({ lineHeight: false }),
    TextAlign.configure({ types: ['heading', 'paragraph', 'image'], alignments: ['right', 'center', 'left', 'justify'] }),
    Direction,
    Subscript,
    Superscript,
    Image.configure({ allowBase64: true, inline: false, resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 40, minHeight: 20 } }),
    TableKit.configure({ table: { resizable: true }, tableCell: false, tableHeader: false }),
    ShadedCell,
    ShadedHeader,
    PageBreak,
    Timeline,
    RepeatBlock,
    FieldNode.configure({ labelOf: o.labelOf }),
    RepeatGuard.configure({ required: o.repeatRequired }),
    BlockHandle,
    Placeholder.configure({ placeholder: o.placeholder ?? 'כתבו כאן…', showOnlyCurrent: true }),
  ];
}

/** Replace the repeat block with its own content (switching to combined mode). */
export function unwrapRepeat(doc: PmNode): { from: number; to: number; content: Fragment } | null {
  let found: { from: number; to: number; content: Fragment } | null = null;
  doc.forEach((n, offset) => {
    if (n.type.name === 'repeatBlock') found = { from: offset, to: offset + n.nodeSize, content: n.content };
  });
  return found;
}
