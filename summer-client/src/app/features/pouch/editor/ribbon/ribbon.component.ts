import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlignCenterOutline,
  AlignLeftOutline,
  AlignRightOutline,
  BoldOutline,
  BorderOutline,
  ClearOutline,
  DeleteColumnOutline,
  DeleteRowOutline,
  DisconnectOutline,
  FontColorsOutline,
  InsertRowAboveOutline,
  InsertRowBelowOutline,
  InsertRowLeftOutline,
  InsertRowRightOutline,
  ItalicOutline,
  LineOutline,
  MenuOutline,
  OrderedListOutline,
  PictureOutline,
  RedoOutline,
  RotateRightOutline,
  ScissorOutline,
  SplitCellsOutline,
  StrikethroughOutline,
  UnderlineOutline,
  ZoomInOutline,
  ZoomOutOutline,
} from '@ant-design/icons-angular/icons';
import { ChainedCommands, Editor } from '@tiptap/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDropDownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule, NzIconService } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { IPouchPage } from '../../../../shared/models';
import { PouchColorsComponent } from '../colors/colors.component';
import { ZOOMS } from '../pouch-editor/pouch-editor.component';
import { DIRECTION_TYPES } from '../pouch-extensions';

type Tab = 'home' | 'insert' | 'layout' | 'table';
type Align = 'right' | 'center' | 'left' | 'justify';
type BlockStyle = 'p' | 'h1' | 'h2' | 'h3';

/** Ribbon-only icons, registered when the (lazy) Pouch editor first loads rather than in the app's bundle. */
const ICONS = [
  AlignCenterOutline,
  AlignLeftOutline,
  AlignRightOutline,
  BoldOutline,
  BorderOutline,
  ClearOutline,
  DeleteColumnOutline,
  DeleteRowOutline,
  DisconnectOutline,
  FontColorsOutline,
  InsertRowAboveOutline,
  InsertRowBelowOutline,
  InsertRowLeftOutline,
  InsertRowRightOutline,
  ItalicOutline,
  LineOutline,
  MenuOutline,
  OrderedListOutline,
  PictureOutline,
  RedoOutline,
  RotateRightOutline,
  ScissorOutline,
  SplitCellsOutline,
  StrikethroughOutline,
  UnderlineOutline,
  ZoomInOutline,
  ZoomOutOutline,
];

export const FONTS = ['Arial', 'David', 'Calibri', 'Times New Roman', 'Tahoma', 'Segoe UI', 'Miriam', 'Narkisim', 'FrankRuehl', 'Courier New'];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
/** What a paragraph or heading is when no size is set on the text (matches the page's CSS and the Word styles). */
const DEFAULT_SIZE: Record<BlockStyle, number> = { p: 11, h1: 20, h2: 16, h3: 13 };

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const TABLE_GRID = 8;

/**
 * The Pouch editor's ribbon, Word-style: tabs (Home, Insert, Layout, and Table while the cursor is in one) over groups
 * of controls with their names under them. Reads the editor's state on every `tick` (each transaction).
 */
@Component({
  selector: 'app-pouch-ribbon',
  imports: [FormsModule, NzButtonModule, NzDropDownModule, NzIconModule, NzInputModule, NzPopoverModule, NzSelectModule, NzToolTipModule, PouchColorsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ribbon.component.html',
  styleUrl: './ribbon.component.scss',
})
export class PouchRibbonComponent {
  private readonly message = inject(NzMessageService);

  readonly editor = input.required<Editor>();
  readonly tick = input(0);
  readonly page = model.required<IPouchPage>();
  readonly zoom = model(100);

  readonly fonts = FONTS;
  readonly sizes = SIZES;
  readonly tab = signal<Tab>('home');

  readonly textColorOpen = signal(false);
  readonly fillColorOpen = signal(false);
  readonly cellColorOpen = signal(false);
  readonly tableOpen = signal(false);
  readonly linkOpen = signal(false);
  readonly linkHref = signal('');
  /** Hovered size in the insert-table grid. */
  readonly grid = signal({ rows: 0, cols: 0 });
  readonly gridCells = Array.from({ length: TABLE_GRID * TABLE_GRID }, (_, i) => ({ row: Math.floor(i / TABLE_GRID) + 1, col: (i % TABLE_GRID) + 1 }));

  private readonly imageInput = viewChild.required<ElementRef<HTMLInputElement>>('imageInput');

  /** Everything the controls show, re-read on each editor transaction. */
  readonly s = computed(() => {
    this.tick();
    const e = this.editor();
    const ts = e.getAttributes('textStyle');
    const block: BlockStyle = e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p';
    const size = parseFloat(String(ts['fontSize'] ?? '')) || DEFAULT_SIZE[block];
    const font = String(ts['fontFamily'] ?? '').split(',')[0].replace(/["']/g, '').trim() || 'Arial';
    const ltr = e.isActive('paragraph', { dir: 'ltr' }) || e.isActive('heading', { dir: 'ltr' });
    return {
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      inTable: e.isActive('table'),
      ltr,
      // No alignment set: the paragraph's own start side (right, or left for a left-to-right one).
      align: ((['right', 'center', 'left', 'justify'] as Align[]).find((a) => e.isActive({ textAlign: a })) ?? (ltr ? 'left' : 'right')) as Align,
      block,
      size,
      font,
      color: (ts['color'] as string | undefined) ?? '',
      fill: (ts['backgroundColor'] as string | undefined) ?? '',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      canMerge: e.can().mergeCells(),
      canSplit: e.can().splitCell(),
    };
  });

  /** The Table tab only exists while the cursor is in a table; leaving one goes back to Home. */
  readonly activeTab = computed<Tab>(() => (this.tab() === 'table' && !this.s().inTable ? 'home' : this.tab()));

  // Commands the template runs by name (through run()).
  readonly undo = (c: ChainedCommands) => c.undo();
  readonly redo = (c: ChainedCommands) => c.redo();
  readonly bold = (c: ChainedCommands) => c.toggleBold();
  readonly italic = (c: ChainedCommands) => c.toggleItalic();
  readonly underline = (c: ChainedCommands) => c.toggleUnderline();
  readonly strike = (c: ChainedCommands) => c.toggleStrike();
  readonly sub = (c: ChainedCommands) => c.unsetSuperscript().toggleSubscript();
  readonly sup = (c: ChainedCommands) => c.unsetSubscript().toggleSuperscript();
  readonly bulletList = (c: ChainedCommands) => c.toggleBulletList();
  readonly orderedList = (c: ChainedCommands) => c.toggleOrderedList();
  readonly quote = (c: ChainedCommands) => c.toggleBlockquote();
  readonly rule = (c: ChainedCommands) => c.setHorizontalRule();
  readonly pageBreak = (c: ChainedCommands) => c.insertContent({ type: 'pageBreak' });
  readonly rowBefore = (c: ChainedCommands) => c.addRowBefore();
  readonly rowAfter = (c: ChainedCommands) => c.addRowAfter();
  readonly colBefore = (c: ChainedCommands) => c.addColumnBefore();
  readonly colAfter = (c: ChainedCommands) => c.addColumnAfter();
  readonly deleteRow = (c: ChainedCommands) => c.deleteRow();
  readonly deleteCol = (c: ChainedCommands) => c.deleteColumn();
  readonly deleteTable = (c: ChainedCommands) => c.deleteTable();
  readonly merge = (c: ChainedCommands) => c.mergeCells();
  readonly split = (c: ChainedCommands) => c.splitCell();
  readonly headerRow = (c: ChainedCommands) => c.toggleHeaderRow();
  /** A timeline of all the summaries (titles only, or with the start of their content). */
  timeline(detail: 'title' | 'content') {
    return (c: ChainedCommands) => c.insertContent([{ type: 'timeline', attrs: { detail } }, { type: 'paragraph' }]);
  }

  constructor() {
    inject(NzIconService).addIcon(...ICONS);
  }

  /** Run a command on the editor (focused). */
  run(cmd: (c: ChainedCommands) => ChainedCommands) {
    cmd(this.editor().chain().focus()).run();
  }

  setBlock(style: BlockStyle) {
    if (style === 'p') this.run((c) => c.setParagraph());
    else this.run((c) => c.setHeading({ level: Number(style[1]) as 1 | 2 | 3 }));
  }

  setFont(font: string) {
    this.run((c) => (font === 'Arial' ? c.unsetFontFamily() : c.setFontFamily(font)));
  }

  setSize(size: number) {
    this.run((c) => (size === DEFAULT_SIZE[this.s().block] ? c.unsetFontSize() : c.setFontSize(`${size}pt`)));
  }

  /** One step up or down the size list (Word's grow / shrink font). */
  stepSize(dir: 1 | -1) {
    const current = this.s().size;
    const next = dir > 0 ? SIZES.find((x) => x > current) : [...SIZES].reverse().find((x) => x < current);
    if (next) this.setSize(next);
  }

  /** Aligning to the paragraph's own start side is its default, so that clears the alignment. */
  setAlign(align: Align) {
    const start = this.s().ltr ? 'left' : 'right';
    this.run((c) => (align === start ? c.unsetTextAlign() : c.setTextAlign(align)));
  }

  /** Word's text direction: the selected paragraphs (and their lists and quotes) right-to-left or left-to-right. */
  setDir(dir: 'rtl' | 'ltr') {
    this.run((c) => DIRECTION_TYPES.reduce((chain, type) => chain.updateAttributes(type, { dir: dir === 'ltr' ? 'ltr' : null }), c));
  }

  setTextColor(color: string) {
    this.textColorOpen.set(false);
    this.run((c) => (color ? c.setColor(color) : c.unsetColor()));
  }

  setFillColor(color: string) {
    this.fillColorOpen.set(false);
    this.run((c) => (color ? c.setBackgroundColor(color) : c.unsetBackgroundColor()));
  }

  setCellColor(color: string) {
    this.cellColorOpen.set(false);
    this.run((c) => c.setCellAttribute('backgroundColor', color || null));
  }

  clearFormatting() {
    this.run((c) => c.unsetAllMarks().unsetTextAlign().setParagraph());
  }

  insertTable(rows: number, cols: number) {
    this.tableOpen.set(false);
    this.grid.set({ rows: 0, cols: 0 });
    this.run((c) => c.insertTable({ rows, cols, withHeaderRow: true }));
  }

  openLink(open: boolean) {
    this.linkOpen.set(open);
    if (open) this.linkHref.set(String(this.editor().getAttributes('link')['href'] ?? ''));
  }

  applyLink() {
    const href = this.linkHref().trim();
    this.linkOpen.set(false);
    if (!href) return this.run((c) => c.extendMarkRange('link').unsetLink());
    const url = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
    const { empty } = this.editor().state.selection;
    if (empty && !this.s().link) this.run((c) => c.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href: url } }] }));
    else this.run((c) => c.extendMarkRange('link').setLink({ href: url }));
  }

  pickImage() {
    this.imageInput().nativeElement.click();
  }

  imageChosen(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|gif)$/.test(file.type)) return void this.message.warning('אפשר להוסיף תמונות PNG, JPEG או GIF');
    if (file.size > MAX_IMAGE_BYTES) return void this.message.warning('התמונה גדולה מדי (עד 3MB)');
    const reader = new FileReader();
    reader.onload = () => this.run((c) => c.setImage({ src: String(reader.result), alt: file.name }));
    reader.readAsDataURL(file);
  }

  setPage(patch: Partial<IPouchPage>) {
    this.page.update((p) => ({ ...p, ...patch }));
  }

  stepZoom(dir: 1 | -1) {
    const i = ZOOMS.indexOf(this.zoom());
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? ZOOMS.indexOf(100) : i) + dir))];
    this.zoom.set(next);
  }
}
