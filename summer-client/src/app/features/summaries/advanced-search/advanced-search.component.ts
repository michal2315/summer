import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { UserService } from '../../../core/auth/user.service';
import { CapsuleWordsInputComponent } from '../../../shared/components/capsules/capsule-words-input/capsule-words-input.component';
import { IQueryGroup, ISummarySearch, QueryField, QueryOp, UserRef } from '../../../shared/models';
import { SUMMARY_COLORS } from '../../../shared/models/colors';
import { CapsuleService } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { FolderPath, FolderService, folderPaths } from '../../../shared/services/folder.service';
import { stripPaging } from '../../../shared/services/search-history.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { capsuleTokenId, isCapsuleToken, treeCapsuleIds } from '../../../shared/utils/capsules';
import {
  EditCondition,
  EditGroup,
  EditNode,
  FIELDS,
  FIELD_KEYS,
  OPS,
  OPS_BY_KIND,
  addChild,
  newCondition,
  newGroup,
  opTone,
  querySentence,
  removeNode,
  toEditable,
  toQuery,
  updateNode,
} from './query-tree';

const MAX_DEPTH = 3;
const COLOR_NAMES: Record<string, string> = {
  '#fe9eae': 'ורוד',
  '#ff0000': 'אדום',
  '#ffa500': 'כתום',
  '#008000': 'ירוק',
  '#00b2b2': 'טורקיז',
  '#0000c9': 'כחול',
  '#800080': 'סגול',
  '#808080': 'אפור',
};

/**
 * Query builder: and / or groups of field conditions, read back as a sentence, with a live result count.
 * The tree is ANDed with the text typed in the search box.
 */
@Component({
  selector: 'app-advanced-search',
  imports: [NgTemplateOutlet, FormsModule, NzButtonModule, NzDatePickerModule, NzIconModule, NzSelectModule, NzToolTipModule, CapsuleWordsInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './advanced-search.component.html',
  styleUrl: './advanced-search.component.scss',
})
export class AdvancedSearchComponent {
  private readonly summaries = inject(SummaryService);
  private readonly users = inject(UserService);
  private readonly folders = inject(FolderService);
  private readonly contentTypes = inject(ContentTypeService);
  private readonly capsules = inject(CapsuleService);

  /** The applied search; its `query` seeds the builder. */
  readonly search = input<ISummarySearch>({});
  /** What is typed in the search box right now (counted together with the tree). */
  readonly text = input('');
  readonly run = output<IQueryGroup | undefined>();
  readonly closed = output<void>();

  readonly fields = FIELDS;
  readonly fieldKeys = FIELD_KEYS;
  readonly ops = OPS;
  readonly opTone = opTone;
  readonly colors = SUMMARY_COLORS;
  readonly colorNames = COLOR_NAMES;
  readonly maxDepth = MAX_DEPTH;

  readonly tree = signal<EditGroup>(newGroup());
  readonly query = computed(() => toQuery(this.tree()));
  readonly sentence = computed(() => querySentence(this.tree(), (field, value) => this.valueName(field, value)));
  readonly hits = signal<number | null>(null);

  // Option lists for the value pickers, plus id → name for everything ever shown (the sentence needs names).
  readonly userOptions = signal<UserRef[]>([]);
  /** Every folder the user can see, by path (searched locally). */
  readonly folderOptions = signal<FolderPath[]>([]);
  private readonly names = signal(new Map<string, string>());
  readonly contentTypeOptions = this.contentTypes.list;
  private readonly userQuery$ = new Subject<string>();
  private readonly count$ = new Subject<ISummarySearch>();

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const q = this.search().query;
      untracked(() => {
        this.tree.set(toEditable(q));
        this.loadNames(q);
      });
    });

    this.userQuery$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => (t.trim() ? this.users.byName(t.trim()) : of([]))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((list) => {
        this.remember(list.map((u) => [u._id, u.fullName]));
        this.userOptions.set(list.filter((u) => !u.isSystem));
      });

    this.folders
      .tree()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((list) => {
        const paths = folderPaths(list);
        this.remember(paths.map((f) => [f._id, f.name]));
        this.folderOptions.set(paths);
      });

    // Live count of what "חיפוש" would find: the box text, the other applied filters and the tree.
    this.count$
      .pipe(
        debounceTime(350),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        switchMap((s) => this.summaries.count(s).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((n) => this.hits.set(n));
    effect(() => {
      const s = { ...stripPaging(this.search()), text: this.text().trim() || undefined, query: this.query(), sort: undefined };
      untracked(() => this.count$.next(s));
    });
  }

  // ---- tree edits

  update(node: EditNode, patch: Partial<EditCondition> | Partial<EditGroup>) {
    this.tree.update((t) => updateNode(t, node.id, patch));
  }

  setField(c: EditCondition, field: QueryField) {
    this.update(c, { field, op: OPS_BY_KIND[FIELDS[field].kind][0], words: [], values: [], from: undefined, to: undefined });
  }

  flip(g: EditGroup) {
    this.update(g, { op: g.op === 'AND' ? 'OR' : 'AND' });
  }

  remove(node: EditNode) {
    this.tree.update((t) => removeNode(t, node.id));
  }

  addCondition(g: EditGroup) {
    this.tree.update((t) => addChild(t, g.id, newCondition()));
  }

  /** A nested group defaults to the other operator: "a and (b or c)" is the usual reason to nest. */
  addGroup(g: EditGroup) {
    this.tree.update((t) => addChild(t, g.id, newGroup(g.op === 'AND' ? 'OR' : 'AND')));
  }

  reset() {
    this.tree.set(newGroup());
  }

  toggleColor(c: EditCondition, color: string) {
    this.update(c, { values: c.values.includes(color) ? c.values.filter((v) => v !== color) : [...c.values, color] });
  }

  setDate(c: EditCondition, key: 'from' | 'to', d: Date | null) {
    this.update(c, { [key]: d ? d.toISOString() : undefined });
  }

  submit() {
    this.run.emit(this.query());
  }

  // ---- template helpers

  opsFor(c: EditCondition): QueryOp[] {
    return OPS_BY_KIND[FIELDS[c.field].kind];
  }

  asDate(iso: string | undefined): Date | null {
    return iso ? new Date(iso) : null;
  }

  isGroup(n: EditNode): n is EditGroup {
    return n.type === 'group';
  }

  asCondition(n: EditNode): EditCondition {
    return n as EditCondition;
  }

  asGroup(n: EditNode): EditGroup {
    return n as EditGroup;
  }

  /** Selected ids first so their names show even when the latest search didn't return them. */
  userOptionsFor(c: EditCondition): { id: string; name: string }[] {
    return this.optionsFor(c.values, this.userOptions().map((u) => ({ id: u._id, name: u.fullName })));
  }

  /** Selected folders the user can no longer see still show (as …) so they can be removed. */
  folderOptionsFor(c: EditCondition): { id: string; name: string }[] {
    return this.optionsFor(
      c.values.filter((id) => !this.folderOptions().some((f) => f._id === id)),
      this.folderOptions().map((f) => ({ id: f._id, name: f.path })),
    );
  }

  searchUsers(text: string) {
    this.userQuery$.next(text);
  }

  private optionsFor(selected: string[], found: { id: string; name: string }[]) {
    const names = this.names();
    const picked = selected.map((id) => ({ id, name: names.get(id) ?? '…' }));
    return [...picked, ...found.filter((f) => !selected.includes(f.id))];
  }

  private valueName(field: QueryField, value: string): string {
    if (isCapsuleToken(value)) return this.capsules.byId(capsuleTokenId(value))?.name ?? '…';
    if (field === 'contentType') return this.contentTypes.list().find((t) => t.name === value)?.displayName ?? value;
    if (field === 'color') return COLOR_NAMES[value] ?? value;
    return this.names().get(value) ?? '…';
  }

  private remember(entries: [string, string][]) {
    if (!entries.length) return;
    this.names.update((m) => new Map([...m, ...entries]));
  }

  /** Names for the user ids in a query loaded from the URL or a pinned search (folder names come with the tree). */
  private loadNames(q: IQueryGroup | undefined) {
    const authors = new Set<string>();
    const walk = (g: IQueryGroup) => g.children.forEach((c) => (c.type === 'group' ? walk(c) : c.field === 'author' && c.values?.forEach((v) => authors.add(v))));
    if (q) walk(q);
    this.capsules.ensure({ ids: treeCapsuleIds(q) });
    if (authors.size) this.users.byIds([...authors]).subscribe((list) => this.remember(list.map((u) => [u._id, u.fullName])));
  }
}
