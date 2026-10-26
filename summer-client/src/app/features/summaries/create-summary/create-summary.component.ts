import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, FormGroup, FormRecord, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { format, parseISO } from 'date-fns';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTimePickerModule } from 'ng-zorro-antd/time-picker';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { NzUploadFile, NzUploadModule } from 'ng-zorro-antd/upload';
import { QuillEditorComponent } from 'ngx-quill';
import type Quill from 'quill';
import { Subject, debounceTime, distinctUntilChanged, filter, forkJoin, map, startWith, switchMap, take } from 'rxjs';
import { HasPendingChanges } from '../../../core/auth/guards';
import { UserService } from '../../../core/auth/user.service';
import { StorageService } from '../../../core/storage/storage.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ContentTypeIconComponent } from '../../../shared/components/content-type-icon/content-type-icon.component';
import {
  FieldsType,
  ICollectionRef,
  IContentType,
  IField,
  ISummary,
  ISummaryParent,
  SUMMARY_KIND_LABEL,
  SearchType,
  SummaryKind,
  SummaryPayload,
  UserRef,
} from '../../../shared/models';
import { DateFormatPipe, RelativeTimePipe } from '../../../shared/pipes/pipes';
import { CollectionService } from '../../../shared/services/collection.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { LabelService } from '../../../shared/services/label.service';
import { PermissionService } from '../../../shared/services/permission.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { FolderService, managedFolderPaths } from '../../../shared/services/folder.service';

type FieldValue = string | number | Date | null;

interface DuplicateHit {
  fieldId: string;
  summaries: { _id: string; title: string }[];
}

const GENERIC = 'generic';
const DAY = 'yyyy-MM-dd';

/** [published, updated] toast per kind. */
const SAVED_TEXT: Record<SummaryKind, [string, string]> = {
  [SummaryKind.Summary]: ['התמצית פורסמה', 'התמצית עודכנה'],
  [SummaryKind.Running]: ['תמצית הרצף פורסמה', 'תמצית הרצף עודכנה'],
  [SummaryKind.Sumaroon]: ['התמציתונית פורסמה', 'התמציתונית עודכנה'],
};

/** Field types in the "שדות נוספים" picker. */
const FIELD_TYPE_LABEL: Record<FieldsType, string> = {
  [FieldsType.String]: 'טקסט',
  [FieldsType.Number]: 'מספר',
  [FieldsType.Date]: 'תאריך',
  [FieldsType.Hour]: 'שעה',
  [FieldsType.Array]: 'רשימה',
};

/** Unsaved form state kept in this browser, per summary (or "new"), so a closed tab or a crash doesn't lose work. */
const LOCAL_DRAFT_KEY = 'summaryFormDraft';
interface LocalDraft {
  savedAt: string;
  value: FormValue;
  /** Display names for the selected collections / tagged users, which the form only holds as ids. */
  collections: ICollectionRef[];
  users: UserRef[];
}
type FormValue = ReturnType<CreateSummaryComponent['form']['getRawValue']>;

/** The running summary a sumaroon is written into, plus the content type it imposes. */
type ParentInfo = ISummaryParent & { contentTypeId: string };
const LABELS_PAGE = 20;

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
    NzRadioModule,
    NzSelectModule,
    NzTimePickerModule,
    NzToolTipModule,
    NzUploadModule,
    QuillEditorComponent,
    AvatarComponent,
    ContentTypeIconComponent,
    DateFormatPipe,
    RelativeTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-summary.component.html',
  styleUrl: './create-summary.component.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class CreateSummaryComponent implements HasPendingChanges {
  private readonly fb = inject(FormBuilder).nonNullable;
  /** Content-type fields; controls are added/removed when the content type changes. */
  readonly typeFields = new FormRecord<FormControl<FieldValue>>({});
  readonly contentTypes = inject(ContentTypeService);
  readonly permissionGroups = inject(PermissionService);
  private readonly labels = inject(LabelService);
  private readonly collectionService = inject(CollectionService);
  readonly users = inject(UserService);
  private readonly summaries = inject(SummaryService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly modal = inject(NzModalService);
  private readonly storage = inject(StorageService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Set by the edit route's resolver (withComponentInputBinding). */
  readonly summary = input<ISummary | undefined>(undefined);
  /** /summaries/new?parentId=… — start a sumaroon inside that running summary. */
  readonly parentId = input<string | undefined>(undefined);
  readonly isEdit = computed(() => !!this.summary());

  readonly K = SummaryKind;
  readonly kindLabel = SUMMARY_KIND_LABEL;
  readonly kinds = [SummaryKind.Summary, SummaryKind.Running, SummaryKind.Sumaroon];

  readonly FT = FieldsType;
  readonly fieldTypeLabel = FIELD_TYPE_LABEL;
  /** Notes stay behind a button until wanted (or already filled). */
  readonly notesOpen = signal(false);
  readonly saving = signal(false);
  private saved = false;
  readonly submitted = signal(false);

  readonly form = this.fb.group({
    kind: [SummaryKind.Summary],
    /** create only: hierarchy folder to place the published summary in */
    folder: [null as string | null],
    /** sumaroon: its running summary */
    parent: [null as string | null],
    /** running: [from, to] */
    range: [[] as Date[]],
    /** sumaroon: source link */
    link: ['', Validators.pattern(/^(https?:\/\/\S+)?$/i)],
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
  readonly contentType = computed<IContentType | undefined>(() => this.contentTypes.list().find((t) => t._id === this.contentTypeId()));
  readonly collectionsRequired = computed(() => this.contentType()?.name === GENERIC && this.kind() !== SummaryKind.Sumaroon);
  readonly typeFieldDefs = computed(() =>
    (this.contentType()?.fields ?? []).flatMap((f) => {
      const field = this.contentTypes.fieldsById().get(f.field);
      return field ? [{ field, required: f.required }] : [];
    }),
  );
  readonly extraFieldValues = toSignal(this.form.controls.extraFields.valueChanges, { initialValue: [] });
  /** Custom fields not already shown as type fields or extra rows. */
  readonly availableExtraFields = computed(() => {
    const used = new Set([...this.typeFieldDefs().map((d) => d.field._id), ...this.extraFieldValues().map((r) => r.field)]);
    // Array fields (labels, permissions…) only exist for notification-rule conditions; summaries edit them elsewhere.
    return this.contentTypes.fields().filter((f) => !used.has(f._id) && f.type !== FieldsType.Array);
  });
  readonly newExtraField = signal<string | null>(null);
  private pendingTypeValues: Record<string, FieldValue> = {};
  readonly duplicates = signal<DuplicateHit[]>([]);

  // ---- hierarchy folder (create only; sumaroons live inside their running summary) ----
  private readonly folderService = inject(FolderService);
  readonly folderOptions = signal<{ _id: string; path: string }[]>([]);

  // ---- kind (summary / running / sumaroon) ----
  readonly kind = toSignal(this.form.controls.kind.valueChanges.pipe(startWith(this.form.controls.kind.value)), { requireSync: true });
  readonly parentInfo = signal<ParentInfo | null>(null);
  readonly parentOptions = signal<{ _id: string; title: string }[]>([]);
  private readonly parentSearch$ = new Subject<string>();
  /** A sumaroon takes its running summary's content type; a running summary with sumaroons keeps its own. */
  readonly contentTypeLocked = computed(
    () => this.kind() === SummaryKind.Sumaroon || (this.kind() === SummaryKind.Running && !!this.summary()?.sumaroonCount),
  );
  /** Sumaroon dates must fall inside the running summary's range. */
  readonly outsideParentRange = (d: Date): boolean => {
    const p = this.parentInfo();
    if (this.kind() !== SummaryKind.Sumaroon || !p) return false;
    const day = format(d, DAY);
    return day < p.rangeStart || day > p.rangeEnd;
  };

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
    return [...this.permissionGroups.assignable()].sort((a, b) => Number(pinned.has(b._id)) - Number(pinned.has(a._id)));
  });
  readonly sortedLabels = computed(() => this.pinFirst(this.labelOptions(), (l) => l, 'pinnedLabels', 'favoriteLabels'));
  readonly sortedCollections = computed(() => this.pinFirst(this.collectionOptions(), (c) => c._id, 'pinnedCollections', 'favoriteCollections'));

  // ---- what's missing (shown beside the save buttons after a failed publish) ----
  /** Ticks on every value/validity change, so the computed below re-reads control state. */
  private readonly formTick = toSignal(this.form.events.pipe(map(() => ({}))), { initialValue: {} });
  readonly missing = computed(() => {
    this.formTick();
    const c = this.form.controls;
    const out: string[] = [];
    const check = (invalid: boolean, name: string) => invalid && out.push(name);
    check(c.contentType.invalid, 'סוג תוכן');
    check(c.parent.invalid, 'תמצית רצף');
    check(c.title.invalid, 'כותרת');
    check(c.content.invalid, 'תוכן');
    check(c.range.invalid, 'טווח תאריכים');
    check(c.eventDate.invalid, 'תאריך האירוע');
    check(c.link.invalid, 'קישור');
    for (const d of this.typeFieldDefs()) check(!!this.typeFields.controls[d.field._id]?.invalid, d.field.name);
    check(c.labels.invalid, 'תגיות');
    check(c.collections.invalid, 'לקטים');
    check(c.permissions.invalid, 'הרשאות');
    return out;
  });

  // ---- local autosave ----
  /** A locally saved draft from an earlier visit, offered for restore. */
  readonly restorable = signal<LocalDraft | null>(null);
  readonly autosavedAt = signal<Date | null>(null);
  private readonly localDraftKey = computed(() => `${LOCAL_DRAFT_KEY}:${this.summary()?._id ?? 'new'}`);

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

    // Collections are required only for the catch-all "generic" type — and never allowed on a sumaroon.
    effect(() => {
      const generic = this.contentType()?.name === GENERIC;
      const sumaroon = this.kind() === SummaryKind.Sumaroon;
      untracked(() => {
        const c = this.form.controls.collections;
        if (sumaroon && c.value.length) c.setValue([]);
        c.setValidators(generic && !sumaroon ? Validators.required : null);
        c.updateValueAndValidity();
      });
    });

    // Required fields per kind: a sumaroon inherits permissions and labels, so its own are optional.
    effect(() => {
      const kind = this.kind();
      untracked(() => {
        const c = this.form.controls;
        const set = (ctrl: FormControl<unknown>, required: boolean) => {
          ctrl.setValidators(required ? Validators.required : null);
          ctrl.updateValueAndValidity({ emitEvent: false });
        };
        set(c.parent as FormControl<unknown>, kind === SummaryKind.Sumaroon);
        set(c.eventDate as FormControl<unknown>, kind === SummaryKind.Sumaroon);
        set(c.range as FormControl<unknown>, kind === SummaryKind.Running);
        set(c.permissions as FormControl<unknown>, kind !== SummaryKind.Sumaroon);
        set(c.labels as FormControl<unknown>, kind !== SummaryKind.Sumaroon);
        if (kind !== SummaryKind.Sumaroon) this.parentInfo.set(null);
      });
    });

    // Opened from a running summary ("add sumaroon"): start inside it.
    effect(() => {
      const id = this.parentId();
      if (id && !this.summary())
        untracked(() => this.form.patchValue({ kind: SummaryKind.Sumaroon, parent: id }));
    });

    // Picking (or populating) the running summary pulls in what the sumaroon inherits.
    this.form.controls.parent.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)).subscribe((id) => {
      if (id) this.loadParent(id);
      else this.parentInfo.set(null);
    });

    this.parentSearch$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((text) =>
          this.summaries.search(this.users.userId()!, { text: text || undefined, searchTypes: [SearchType.Title], kinds: [SummaryKind.Running], limit: 20 }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        const current = this.parentInfo();
        const list = res.summaries.map((s) => ({ _id: s._id, title: s.title }));
        this.parentOptions.set(mergeById(current ? [{ _id: current._id, title: current.title }] : [], list));
      });
    this.parentSearch$.next('');

    // Folders the user may place a summary in.
    if (!this.summary())
      this.folderService
        .tree()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((list) => this.folderOptions.set(managedFolderPaths(list, this.users.userId() ?? '')));

    // Populate from the resolved summary (edit mode) once the content types and fields needed to split type/extra fields are in.
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
          return this.labels.search(text, 0);
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
        switchMap((t) => this.collectionService.byName(t)),
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

    // Offer to restore unsaved work from an earlier visit (the key is known once the edit resolver's input is set).
    effect(() => {
      const key = this.localDraftKey();
      untracked(() => this.restorable.set(this.storage.get<LocalDraft>(key)));
    });

    // Autosave while editing — paused while an older draft waits for restore/discard, so it isn't overwritten.
    this.form.valueChanges
      .pipe(
        debounceTime(1000),
        filter(() => this.form.dirty && !this.saved && !this.restorable()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.saveLocalDraft());
  }

  private saveLocalDraft() {
    const v = this.form.getRawValue();
    const draft: LocalDraft = {
      savedAt: new Date().toISOString(),
      value: v,
      collections: this.collectionOptions().filter((c) => v.collections.includes(c._id)),
      users: this.userOptions().filter((u) => v.taggedUsers.includes(u._id)),
    };
    this.storage.set(this.localDraftKey(), draft);
    this.autosavedAt.set(new Date());
  }

  private clearLocalDraft() {
    this.storage.remove(this.localDraftKey());
    this.autosavedAt.set(null);
  }

  restoreDraft() {
    const d = this.restorable();
    if (!d) return;
    const { typeFields, extraFields, kind, contentType, ...rest } = reviveDates(d.value);
    // Same order as fill(): kind and type first, so the type-field group is rebuilt with the saved values.
    this.pendingTypeValues = typeFields;
    this.form.controls.kind.setValue(kind);
    this.form.controls.contentType.setValue(contentType);
    this.form.controls.typeFields.patchValue(typeFields);
    this.form.patchValue(rest);
    this.form.controls.extraFields.clear();
    for (const e of extraFields) this.addExtraRow(e.field, e.value);
    this.labelOptions.update((l) => this.withSelected(l, rest.labels));
    this.collectionOptions.update((c) => mergeById(d.collections, c));
    this.userOptions.update((u) => mergeById(d.users, u));
    this.notesOpen.set(!!rest.notes);
    this.form.markAsDirty();
    this.restorable.set(null);
    this.message.success('העבודה שוחזרה');
  }

  discardDraft() {
    this.clearLocalDraft();
    this.restorable.set(null);
  }

  /** Closing the tab or reloading with unsaved changes: let the browser ask first. */
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.canLeave()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private populate(s: ISummary) {
    forkJoin([this.contentTypes.list$.pipe(take(1)), this.contentTypes.fields$.pipe(take(1))])
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
    this.form.controls.kind.setValue(s.kind ?? SummaryKind.Summary);
    if (s.parent) {
      this.parentInfo.set({ ...s.parent, contentTypeId: s.contentType._id });
      this.parentOptions.update((o) => mergeById([{ _id: s.parent!._id, title: s.parent!.title }], o));
    }
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
      parent: s.parentId ?? null,
      range: s.rangeStart && s.rangeEnd ? [parseISO(s.rangeStart), parseISO(s.rangeEnd)] : [],
      link: s.link ?? '',
    });
    this.form.controls.extraFields.clear();
    for (const e of extra) this.addExtraRow(e.field, e.value);
    this.labelOptions.update((l) => this.withSelected(l, s.labels.map((x) => x.name)));
    this.collectionOptions.update((c) => mergeById(s.collectionIds, c));
    this.userOptions.set(s.taggedUsers);
    this.existingFiles.set([...s.files]);
    this.notesOpen.set(!!s.notes);
    this.form.markAsPristine();
  }

  // ---- running summary (sumaroon parent) ----
  onParentSearch(text: string) {
    this.parentSearch$.next(text);
  }

  /** Take over the running summary's content type and move the event date inside its range. */
  private loadParent(id: string) {
    this.summaries.get(id).subscribe((p) => {
      if (p.kind !== SummaryKind.Running || !p.rangeStart || !p.rangeEnd) return;
      this.parentInfo.set({
        _id: p._id,
        title: p.title,
        rangeStart: p.rangeStart,
        rangeEnd: p.rangeEnd,
        labels: p.labels,
        permissions: p.permissions,
        contentTypeId: p.contentType._id,
      });
      this.parentOptions.update((o) => mergeById([{ _id: p._id, title: p.title }], o));
      this.form.controls.contentType.setValue(p.contentType._id);
      const date = this.form.controls.eventDate.value;
      if (!date || this.outsideParentRange(date)) this.form.controls.eventDate.setValue(parseISO(p.rangeStart));
    });
  }

  // ---- template helpers ----
  pickContentType(t: IContentType) {
    if (this.contentTypeLocked()) return;
    this.form.controls.contentType.setValue(t._id);
    this.form.controls.contentType.markAsDirty();
  }

  fieldName(id: string): string {
    return this.contentTypes.fieldsById().get(id)?.name ?? '';
  }

  fieldType(id: string): FieldsType {
    return this.contentTypes.fieldsById().get(id)?.type ?? FieldsType.String;
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
    this.summaries.byField(field._id, text).subscribe((list) => {
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
    this.labels.search(this.labelQuery, this.labelOptions().length).subscribe((list) => {
      this.labelOptions.update((cur) => [...new Set([...cur, ...list])]);
      this.labelsDone = list.length < LABELS_PAGE;
      this.labelsLoading.set(false);
    });
  }

  onCollectionSearch(text: string) {
    this.collectionSearch$.next(text);
  }

  onUserSearch(text: string) {
    if (text.trim()) this.userSearch$.next(text.trim());
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
    return this.permissionGroups.list().find((p) => p._id === id)?.color ?? '#ccc';
  }

  removeExistingFile(name: string) {
    this.existingFiles.update((f) => f.filter((x) => x !== name));
    this.form.markAsDirty();
  }

  confirmReset() {
    this.modal.confirm({
      nzTitle: this.isEdit() ? 'לבטל את כל השינויים?' : 'לנקות את כל הטופס?',
      nzContent: this.isEdit() ? 'התמצית תחזור למצב השמור האחרון.' : 'כל מה שמילאת, כולל הקבצים שצורפו, יימחק.',
      nzOkText: this.isEdit() ? 'ביטול השינויים' : 'ניקוי',
      nzOkDanger: true,
      nzCancelText: 'חזרה לטופס',
      nzOnOk: () => this.resetForm(),
    });
  }

  private resetForm() {
    const s = this.summary();
    if (s) this.populate(s);
    else {
      this.form.reset();
      this.form.controls.extraFields.clear();
      this.fileList.set([]);
      this.notesOpen.set(false);
    }
    this.submitted.set(false);
    this.duplicates.set([]);
    this.clearLocalDraft();
  }

  /** Bring the first field with an error into view and focus it. */
  scrollToFirstError() {
    // After change detection, so the error classes are on the page.
    setTimeout(() => {
      const el = this.host.nativeElement.querySelector<HTMLElement>('.ant-form-item-has-error, .types.no-selection-error');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.querySelector<HTMLElement>('input, textarea, .ql-editor, button')?.focus({ preventScroll: true });
    });
  }

  canLeave(): boolean {
    return this.saved || (this.form.pristine && !this.fileList().length);
  }

  // ---- submit ----
  submit(isDraft: boolean) {
    this.submitted.set(true);
    const c = this.form.controls;
    // Drafts only need a title (plus what their kind can't exist without); publishing validates everything.
    const kindValid = c.parent.valid && c.range.valid && (this.kind() !== SummaryKind.Sumaroon || c.eventDate.valid);
    const valid = isDraft ? c.title.valid && kindValid : this.form.valid;
    if (!valid) {
      this.form.markAllAsTouched();
      for (const ctrl of Object.values(c.typeFields.controls)) ctrl.markAsDirty();
      for (const ctrl of [c.title, c.content, c.permissions, c.labels, c.collections, c.parent, c.range, c.eventDate]) ctrl.markAsDirty();
      this.message.warning(isDraft ? 'חובה למלא כותרת' : 'יש להשלים את שדות החובה המסומנים');
      this.scrollToFirstError();
      return;
    }

    const v = this.form.getRawValue();
    const fieldsById = this.contentTypes.fieldsById();
    const summaryFields = [
      ...Object.entries(v.typeFields).map(([field, value]) => ({ field, value })),
      ...v.extraFields.map((r) => ({ field: r.field, value: r.value })),
    ]
      .map(({ field, value }) => ({ field, value: serialize(fieldsById.get(field)?.type ?? FieldsType.String, value) }))
      .filter((f) => f.value !== '');

    const kind = v.kind;
    const payload: SummaryPayload = {
      id: this.summary()?._id,
      kind,
      parentId: kind === SummaryKind.Sumaroon ? (v.parent ?? undefined) : undefined,
      rangeStart: kind === SummaryKind.Running && v.range.length === 2 ? format(v.range[0], DAY) : undefined,
      rangeEnd: kind === SummaryKind.Running && v.range.length === 2 ? format(v.range[1], DAY) : undefined,
      link: kind === SummaryKind.Sumaroon ? v.link.trim() || undefined : undefined,
      title: v.title.trim(),
      contentHtml: v.content,
      notesHtml: v.notes,
      contentType: v.contentType,
      // A running summary is dated by its range.
      eventDate: v.eventDate && kind !== SummaryKind.Running ? format(v.eventDate, DAY) : undefined,
      eventSecTime: v.eventSecTime && kind !== SummaryKind.Running ? format(v.eventSecTime, 'HH:mm') : undefined,
      department: v.department,
      labels: v.labels,
      collectionIds: kind === SummaryKind.Sumaroon ? [] : v.collections,
      permissions: v.permissions,
      taggedUsers: v.taggedUsers,
      summaryFields,
      files: this.existingFiles(),
      isDraft,
    };
    const files = this.fileList().map((f) => (f.originFileObj ?? f) as unknown as File);

    this.saving.set(true);
    const req = this.isEdit() ? this.summaries.update(payload, files) : this.summaries.create(payload, files);
    const folder = !this.isEdit() && kind !== SummaryKind.Sumaroon ? v.folder : null;
    req.subscribe({
      next: (s) => {
        this.saved = true;
        this.saving.set(false);
        this.clearLocalDraft();
        if (folder && isDraft) this.message.info('טיוטות לא נכנסות לתיקיות — אפשר לשייך לתיקייה אחרי הפרסום');
        else if (folder) this.folderService.addItems(folder, [{ type: 'summary', _id: s._id }]).subscribe();
        this.message.success(isDraft ? 'הטיוטה נשמרה' : SAVED_TEXT[kind][this.isEdit() ? 1 : 0]);
        if (isDraft) this.router.navigate(['/profile', this.users.userId()], { queryParams: { tab: 'DRAFT' } });
        // Running summaries have their own page; a sumaroon opens in its running summary's panel.
        else if (s.kind === SummaryKind.Running) this.router.navigate(['/running', s._id]);
        else if (s.parentId) this.router.navigate(['/running', s.parentId], { queryParams: { summaryId: s._id } });
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

/** JSON turns Dates into ISO strings; turn them back (dates, times and ranges are Date values in the form). */
function reviveDates<T>(value: T): T {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return new Date(value) as T;
  if (Array.isArray(value)) return value.map(reviveDates) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveDates(v)])) as T;
  return value;
}

function mergeById<T extends { _id: string }>(a: T[], b: T[]): T[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((x) => !seen.has(x._id) && seen.add(x._id));
}
