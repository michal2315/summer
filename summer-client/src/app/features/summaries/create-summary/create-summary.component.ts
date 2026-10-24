import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, FormRecord, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { format } from 'date-fns';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTimePickerModule } from 'ng-zorro-antd/time-picker';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzUploadFile, NzUploadModule } from 'ng-zorro-antd/upload';
import { QuillEditorComponent } from 'ngx-quill';
import type Quill from 'quill';
import { Subject, debounceTime, distinctUntilChanged, forkJoin, startWith, switchMap, take } from 'rxjs';
import { HasPendingChanges } from '../../../core/auth/guards';
import { UserService } from '../../../core/auth/user.service';
import { AvatarComponent } from '../../../shared/components/avatar.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon.component';
import { FieldsType, ICollectionRef, IContentType, IField, ISummary, SummaryPayload, UserRef } from '../../../shared/models';
import { CatalogService } from '../../../shared/services/catalog.service';
import { SummaryService } from '../../../shared/services/summary.service';

type FieldValue = string | number | Date | null;

interface DuplicateHit {
  fieldId: string;
  summaries: { _id: string; title: string }[];
}

const GENERIC = 'generic';
const LABELS_PAGE = 20;

/** `#word` in the content becomes a label on submit. */
export function hashtags(html: string): string[] {
  // Quill puts each line in its own block; separate them so a #tag at the start of a line is still preceded by whitespace.
  const spaced = html.replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>|<br\s*\/?>/gi, '$& ');
  const text = new DOMParser().parseFromString(spaced, 'text/html').body.textContent ?? '';
  return [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].replace(/_/g, ' '));
}

@Component({
  selector: 'app-create-summary',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    NzButtonModule,
    NzDatePickerModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzPopoverModule,
    NzSelectModule,
    NzTimePickerModule,
    NzToolTipModule,
    NzUploadModule,
    QuillEditorComponent,
    AvatarComponent,
    ContentTypeIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-summary.component.html',
  styleUrl: './create-summary.component.scss',
})
export class CreateSummaryComponent implements HasPendingChanges {
  private readonly fb = inject(FormBuilder).nonNullable;
  /** Content-type fields; controls are added/removed when the content type changes. */
  readonly typeFields = new FormRecord<FormControl<FieldValue>>({});
  readonly catalog = inject(CatalogService);
  readonly users = inject(UserService);
  private readonly summaries = inject(SummaryService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly destroyRef = inject(DestroyRef);

  /** Set by the edit route's resolver (withComponentInputBinding). */
  readonly summary = input<ISummary | undefined>(undefined);
  readonly isEdit = computed(() => !!this.summary());

  readonly FT = FieldsType;
  readonly saving = signal(false);
  private saved = false;
  readonly submitted = signal(false);

  readonly form = this.fb.group({
    contentType: ['', Validators.required],
    permissions: [[] as string[], Validators.required],
    title: ['', [Validators.required, Validators.maxLength(200)]],
    content: ['', Validators.required],
    labels: [[] as string[], Validators.required],
    collections: [[] as string[]],
    taggedUsers: [[] as string[]],
    notes: [''],
    eventDate: [new Date() as Date | null],
    eventSecTime: [null as Date | null],
    department: [this.users.user()?.department ?? ''],
    typeFields: this.typeFields,
    extraFields: new FormArray<FormGroup<{ field: FormControl<string>; value: FormControl<FieldValue> }>>([]),
  });

  // Files: new uploads (kept client-side until submit) + existing attachment names (edit).
  readonly fileList = signal<NzUploadFile[]>([]);
  readonly existingFiles = signal<string[]>([]);
  readonly beforeUpload = (file: NzUploadFile): boolean => {
    this.fileList.update((l) => [...l, file]);
    this.form.markAsDirty();
    return false;
  };

  // ---- content type & dynamic fields ----
  private readonly contentTypeId = toSignal(this.form.controls.contentType.valueChanges.pipe(startWith(this.form.controls.contentType.value)), {
    requireSync: true,
  });
  readonly contentType = computed<IContentType | undefined>(() => this.catalog.contentTypes().find((t) => t._id === this.contentTypeId()));
  readonly typeFieldDefs = computed(() =>
    (this.contentType()?.fields ?? []).flatMap((f) => {
      const field = this.catalog.fieldsById().get(f.field);
      return field ? [{ field, required: f.required }] : [];
    }),
  );
  readonly extraFieldValues = toSignal(this.form.controls.extraFields.valueChanges, { initialValue: [] });
  /** Catalog fields not already shown as type fields or extra rows. */
  readonly availableExtraFields = computed(() => {
    const used = new Set([...this.typeFieldDefs().map((d) => d.field._id), ...this.extraFieldValues().map((r) => r.field)]);
    // Array fields (labels, permissions…) only exist for notification-rule conditions; summaries edit them elsewhere.
    return this.catalog.fields().filter((f) => !used.has(f._id) && f.type !== FieldsType.Array);
  });
  readonly newExtraField = signal<string | null>(null);
  private pendingTypeValues: Record<string, FieldValue> = {};
  readonly duplicates = signal<DuplicateHit[]>([]);

  // ---- server-driven option lists ----
  readonly labelOptions = signal<string[]>([]);
  readonly labelsLoading = signal(false);
  private labelQuery = '';
  private labelsDone = false;
  private readonly labelSearch$ = new Subject<string>();

  readonly collectionOptions = signal<ICollectionRef[]>([]);
  private readonly collectionSearch$ = new Subject<string>();

  readonly userOptions = signal<UserRef[]>([]);
  private readonly userSearch$ = new Subject<string>();

  readonly sortedPermissions = computed(() => {
    const pinned = new Set(this.users.user()?.pinnedPermissions ?? []);
    return [...this.catalog.permissions()].sort((a, b) => Number(pinned.has(b._id)) - Number(pinned.has(a._id)));
  });
  readonly sortedLabels = computed(() => this.pinFirst(this.labelOptions(), (l) => l, 'pinnedLabels', 'favoriteLabels'));
  readonly sortedCollections = computed(() => this.pinFirst(this.collectionOptions(), (c) => c._id, 'pinnedCollections', 'favoriteCollections'));

  readonly editorPlaceholder = 'תתפרעו :) הוסיפו # לפני מילה בשביל להפוך אותה לתגית';

  constructor() {
    // Rebuild the content-type field group, keeping values of fields that exist in both types.
    effect(() => {
      const defs = this.typeFieldDefs();
      untracked(() => {
        const group = this.typeFields;
        const old = group.getRawValue();
        for (const key of Object.keys(group.controls)) group.removeControl(key, { emitEvent: false });
        for (const { field, required } of defs) {
          const value = old[field._id] ?? this.pendingTypeValues[field._id] ?? null;
          group.addControl(field._id, new FormControl<FieldValue>(value, required ? Validators.required : null), { emitEvent: false });
        }
        group.updateValueAndValidity();
      });
    });

    // Collections are required only for the catch-all "generic" type.
    effect(() => {
      const generic = this.contentType()?.name === GENERIC;
      untracked(() => {
        const c = this.form.controls.collections;
        c.setValidators(generic ? Validators.required : null);
        c.updateValueAndValidity();
      });
    });

    // Populate from the resolved summary (edit mode) once the catalogs needed to split type/extra fields are in.
    effect(() => {
      const s = this.summary();
      if (s) untracked(() => this.populate(s));
    });


    this.labelSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((text) => {
          this.labelQuery = text;
          this.labelsDone = false;
          this.labelsLoading.set(true);
          return this.catalog.labels(text, 0);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => {
        this.labelOptions.set(this.withSelected(list, this.form.controls.labels.value));
        this.labelsDone = list.length < LABELS_PAGE;
        this.labelsLoading.set(false);
      });

    this.collectionSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => this.catalog.collectionsByName(t)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => this.collectionOptions.update((cur) => mergeById(cur.filter((c) => this.form.controls.collections.value.includes(c._id)), list)));

    this.userSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => this.users.byName(t)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((list) => this.userOptions.update((cur) => mergeById(cur.filter((u) => this.form.controls.taggedUsers.value.includes(u._id)), list)));

    this.labelSearch$.next('');
    this.collectionSearch$.next('');
  }

  private populate(s: ISummary) {
    forkJoin([this.catalog.contentTypes$.pipe(take(1)), this.catalog.fields$.pipe(take(1))])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([types]) => this.fill(s, types.find((t) => t._id === s.contentType._id) ?? s.contentType));
  }

  private fill(s: ISummary, type: IContentType) {
    const typeFieldIds = new Set((type.fields ?? []).map((f) => f.field));
    const typeFields: Record<string, FieldValue> = {};
    const extra: { field: string; value: FieldValue }[] = [];
    for (const sf of s.summaryFields ?? []) {
      const value = sf.field.type === FieldsType.Date && sf.value ? new Date(sf.value) : (sf.value ?? null);
      if (typeFieldIds.has(sf.field._id)) typeFields[sf.field._id] = value;
      else extra.push({ field: sf.field._id, value });
    }

    // The type-field group is rebuilt by an effect after contentType changes; it picks values up from here.
    this.pendingTypeValues = typeFields;
    this.form.controls.contentType.setValue(s.contentType._id);
    this.form.controls.typeFields.patchValue(typeFields);
    this.form.patchValue({
      permissions: s.permissions.map((p) => p._id),
      title: s.title,
      content: s.content,
      labels: s.labels.map((l) => l.name),
      collections: s.collectionIds.map((c) => c._id),
      taggedUsers: s.taggedUsers.map((u) => u._id),
      notes: s.notes ?? '',
      eventDate: s.eventDate ? new Date(s.eventDate) : null,
      eventSecTime: s.eventSecTime ? new Date(s.eventSecTime) : null,
      department: s.department,
    });
    this.form.controls.extraFields.clear();
    for (const e of extra) this.addExtraRow(e.field, e.value);
    this.labelOptions.update((l) => this.withSelected(l, s.labels.map((x) => x.name)));
    this.collectionOptions.update((c) => mergeById(s.collectionIds, c));
    this.userOptions.set(s.taggedUsers);
    this.existingFiles.set([...s.files]);
    this.form.markAsPristine();
  }

  // ---- template helpers ----
  pickContentType(t: IContentType) {
    this.form.controls.contentType.setValue(t._id);
    this.form.controls.contentType.markAsDirty();
  }

  fieldName(id: string): string {
    return this.catalog.fieldsById().get(id)?.name ?? '';
  }

  fieldType(id: string): FieldsType {
    return this.catalog.fieldsById().get(id)?.type ?? FieldsType.String;
  }

  addExtraField() {
    const id = this.newExtraField();
    if (!id) return;
    this.addExtraRow(id, null);
    this.newExtraField.set(null);
    this.form.markAsDirty();
  }

  private addExtraRow(field: string, value: FieldValue) {
    this.form.controls.extraFields.push(
      this.fb.group({ field: this.fb.control(field), value: new FormControl<FieldValue>(value) }) as FormGroup<{
        field: FormControl<string>;
        value: FormControl<FieldValue>;
      }>,
    );
  }

  removeExtraField(i: number) {
    this.form.controls.extraFields.removeAt(i);
    this.form.markAsDirty();
  }

  /** On blur: other summaries already using this field value → soft warning (never blocks submit). */
  checkDuplicate(field: IField, value: FieldValue) {
    const text = serialize(field.type, value);
    this.duplicates.update((d) => d.filter((x) => x.fieldId !== field._id));
    if (!text) return;
    this.catalog.summariesByField(field._id, text).subscribe((list) => {
      const others = list.filter((s) => s._id !== this.summary()?._id);
      if (others.length) this.duplicates.update((d) => [...d, { fieldId: field._id, summaries: others }]);
    });
  }

  duplicateFor(fieldId: string) {
    return this.duplicates().find((d) => d.fieldId === fieldId);
  }

  onEditorCreated(editor: Quill) {
    editor.format('direction', 'rtl');
    editor.format('align', 'right');
  }

  onLabelSearch(text: string) {
    this.labelSearch$.next(text);
  }

  loadMoreLabels() {
    if (this.labelsDone || this.labelsLoading()) return;
    this.labelsLoading.set(true);
    this.catalog.labels(this.labelQuery, this.labelOptions().length).subscribe((list) => {
      this.labelOptions.update((cur) => [...new Set([...cur, ...list])]);
      this.labelsDone = list.length < LABELS_PAGE;
      this.labelsLoading.set(false);
    });
  }

  onCollectionSearch(text: string) {
    this.collectionSearch$.next(text);
  }

  onUserSearch(text: string) {
    if (text.trim().length > 1) this.userSearch$.next(text.trim());
  }

  isPinned(kind: 'pinnedLabels' | 'pinnedPermissions' | 'pinnedCollections', id: string) {
    return this.users.user()?.[kind].includes(id) ?? false;
  }

  isFavorite(kind: 'favoriteLabels' | 'favoriteCollections', id: string) {
    return this.users.user()?.[kind].includes(id) ?? false;
  }

  /** Pin/star buttons live inside select options — don't let the click select the option. */
  optionAction(event: Event, action: () => void) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  pinLabel = (l: string) => this.users.pinLabel(l).subscribe();
  favoriteLabel = (l: string) => this.users.favoriteEntity('label', l).subscribe();
  pinPermission = (id: string) => this.users.pinPermission(id).subscribe();
  pinCollection = (id: string) => this.users.pinCollection(id).subscribe();
  favoriteCollection = (id: string) => this.users.favoriteEntity('collection', id).subscribe();

  permissionColor(id: string) {
    return this.catalog.permissions().find((p) => p._id === id)?.color ?? '#ccc';
  }

  removeExistingFile(name: string) {
    this.existingFiles.update((f) => f.filter((x) => x !== name));
    this.form.markAsDirty();
  }

  resetForm() {
    const s = this.summary();
    if (s) this.populate(s);
    else {
      this.form.reset();
      this.form.controls.extraFields.clear();
      this.fileList.set([]);
    }
    this.submitted.set(false);
    this.duplicates.set([]);
  }

  canLeave(): boolean {
    return this.saved || (this.form.pristine && !this.fileList().length);
  }

  // ---- submit ----
  submit(isDraft: boolean) {
    this.submitted.set(true);
    const c = this.form.controls;
    // Drafts only need a title; publishing validates everything.
    const valid = isDraft ? c.title.valid : this.form.valid;
    if (!valid) {
      this.form.markAllAsTouched();
      for (const ctrl of Object.values(c.typeFields.controls)) ctrl.markAsDirty();
      for (const ctrl of [c.title, c.content, c.permissions, c.labels, c.collections]) ctrl.markAsDirty();
      this.message.warning(isDraft ? 'חובה למלא כותרת' : 'יש להשלים את שדות החובה המסומנים');
      return;
    }

    const v = this.form.getRawValue();
    const fieldsById = this.catalog.fieldsById();
    const summaryFields = [
      ...Object.entries(v.typeFields).map(([field, value]) => ({ field, value })),
      ...v.extraFields.map((r) => ({ field: r.field, value: r.value })),
    ]
      .map(({ field, value }) => ({ field, value: serialize(fieldsById.get(field)?.type ?? FieldsType.String, value) }))
      .filter((f) => f.value !== '');

    const payload: SummaryPayload = {
      id: this.summary()?._id,
      title: v.title.trim(),
      contentHtml: v.content,
      notesHtml: v.notes,
      contentType: v.contentType,
      eventDate: v.eventDate ? format(v.eventDate, 'yyyy-MM-dd') : undefined,
      eventSecTime: v.eventSecTime ? format(v.eventSecTime, 'HH:mm') : undefined,
      department: v.department,
      labels: [...new Set([...v.labels, ...hashtags(v.content)])],
      collectionIds: v.collections,
      permissions: v.permissions,
      taggedUsers: v.taggedUsers,
      summaryFields,
      files: this.existingFiles(),
      isDraft,
    };
    const files = this.fileList().map((f) => (f.originFileObj ?? f) as unknown as File);

    this.saving.set(true);
    const req = this.isEdit() ? this.summaries.update(payload, files) : this.summaries.create(payload, files);
    req.subscribe({
      next: (s) => {
        this.saved = true;
        this.saving.set(false);
        this.message.success(isDraft ? 'הטיוטה נשמרה' : this.isEdit() ? 'הסיכום עודכן' : 'הסיכום פורסם');
        if (isDraft) this.router.navigate(['/profile', this.users.userId()], { queryParams: { tab: 'DRAFT' } });
        else this.router.navigate(['/summaries'], { queryParams: { summaryId: s._id } });
      },
      error: () => this.saving.set(false),
    });
  }

  private withSelected(list: string[], selected: string[]) {
    return [...new Set([...selected, ...list])];
  }

  private pinFirst<T>(
    list: T[],
    id: (x: T) => string,
    pinnedKey: 'pinnedLabels' | 'pinnedCollections',
    favKey: 'favoriteLabels' | 'favoriteCollections',
  ): T[] {
    const u = this.users.user();
    const rank = (x: T) => (u?.[pinnedKey].includes(id(x)) ? 0 : u?.[favKey].includes(id(x)) ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }
}

function serialize(type: FieldsType, value: FieldValue): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return type === FieldsType.Hour ? format(value, 'HH:mm') : value.toISOString();
  return String(value);
}

function mergeById<T extends { _id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((x) => !seen.has(x._id) && seen.add(x._id));
}
