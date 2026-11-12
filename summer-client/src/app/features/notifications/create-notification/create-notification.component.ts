import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { catchError, concat, debounceTime, of, switchMap } from 'rxjs';
import { HasPendingChanges } from '../../../core/auth/guards';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { INotificationSettings, INotificationSettingsCondition, ISummarySearch, NotificationsFunctionsOptions, SearchType } from '../../../shared/models';
import { CapsuleService } from '../../../shared/services/capsule.service';
import { ContentTypeService } from '../../../shared/services/content-type.service';
import { SummaryService } from '../../../shared/services/summary.service';
import { alertSearch, describeSearch, searchToParams } from '../../summaries/search-query';
import { SummarySearchComponent } from '../../summaries/summary-search/summary-search.component';
import { CreateNotificationConditionComponent } from '../create-notification-condition/create-notification-condition.component';
import { NotificationsSettingsService, SUMMARY_TEXT_FIELD, describeRule } from '../notification-rules';

/** Search filters shown as chips (the text and the advanced search live in the search box). */
type FilterKey = 'searchTypes' | 'contentTypes' | 'labels' | 'colors' | 'users' | 'folders' | 'dates' | 'createdDates';
const SEARCH_IN: Partial<Record<SearchType, string>> = {
  [SearchType.Title]: 'כותרת',
  [SearchType.Content]: 'תוכן',
  [SearchType.Label]: 'תגיות',
  [SearchType.Notes]: 'הערות',
  [SearchType.Comments]: 'תגובות',
  [SearchType.Color]: 'צבע',
};

/**
 * /notifications/create and /notifications/:id/edit — rule name, delivery channels, and either condition rows (all of
 * them or any one) or, for a search alert, the saved search. `?capsule=<id>` starts a rule on that capsule.
 */
@Component({
  selector: 'app-create-notification',
  imports: [ReactiveFormsModule, RouterLink, NzButtonModule, NzCheckboxModule, NzFormModule, NzIconModule, NzInputModule, NzRadioModule, CreateNotificationConditionComponent, SkeletonComponent, SummarySearchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-notification.component.html',
  styleUrl: './create-notification.component.scss',
})
export class CreateNotificationComponent implements HasPendingChanges {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly service = inject(NotificationsSettingsService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);
  private readonly capsules = inject(CapsuleService);
  private readonly contentTypes = inject(ContentTypeService);
  private readonly summaries = inject(SummaryService);

  /** Route param on the edit route. */
  readonly id = input<string | undefined>(undefined);
  /** Query param: start a new rule on this capsule. */
  readonly capsule = input<string | undefined>(undefined);

  readonly form = this.fb.group(
    {
      name: ['', [Validators.required, Validators.maxLength(120)]],
      isNotify: true,
      isMail: false,
      isDigest: false,
      matchAny: false,
      conditions: new FormArray<FormControl<INotificationSettingsCondition | null>>([this.conditionControl()]),
    },
  );

  readonly submitted = signal(false);
  readonly saving = signal(false);
  /** Editing: the rule is on its way, so the form is not filled in yet. */
  readonly loadingRule = signal(false);
  readonly preview = signal('');
  /** A search alert's saved search (its conditions are the search, not rows). */
  readonly search = signal<ISummarySearch | undefined>(undefined);
  readonly describeSearch = describeSearch;
  /** Why this rule's e-mails wouldn't go out, if they wouldn't. */
  readonly mailBlocked = computed(() => {
    const p = this.service.preferences();
    if (!p) return '';
    if (!p.email) return 'אין כתובת מייל בחשבון שלך, ולכן לא יישלחו מיילים.';
    return p.mailAlerts ? '' : 'מיילים על כללי התראה כבויים בניהול ההתראות, ולכן לא יישלחו מיילים על הכלל הזה.';
  });
  private saved = false;
  private creationDate?: string;

  constructor() {
    this.service.loadPreferences();
    this.form.valueChanges.subscribe(() => this.updatePreview());
    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.loadRule(id));
    });
    effect(() => {
      const capsule = this.capsule();
      if (capsule && !this.id()) untracked(() => this.startWithCapsule(capsule));
    });
  }

  private updatePreview() {
    const v = this.form.getRawValue();
    const done = v.conditions.filter((c): c is INotificationSettingsCondition => !!c);
    const search = this.search();
    this.preview.set(search || done.length ? `תתקבל התראה על ${describeRule({ conditions: done, matchAny: v.matchAny, search })}` : '');
  }

  /** From the capsules page: "the summary's text matches this capsule", named after it. */
  private startWithCapsule(id: string) {
    this.capsules.get(id).subscribe((c) => {
      if (!c) return;
      const condition: INotificationSettingsCondition = { field: SUMMARY_TEXT_FIELD, funcName: NotificationsFunctionsOptions.CapsuleMatches, content: [c._id, c.name] };
      this.form.controls.conditions.at(0).setValue(condition);
      this.form.patchValue({ name: `כמוסה: ${c.name}` });
      this.form.markAsDirty();
    });
  }

  /** The search box changed the alert's search (paging and sort don't belong to an alert). */
  setSearch(s: ISummarySearch) {
    this.search.set(alertSearch(s));
    this.form.markAsDirty();
    this.updatePreview();
  }

  removeFilter(key: FilterKey) {
    const s = { ...this.search() };
    delete s[key];
    this.setSearch(s);
  }

  /** The search's filters the search box doesn't show as text, one removable chip each. */
  readonly searchFilters = computed(() => {
    const s = this.search();
    if (!s) return [];
    const typeNames = new Map(this.contentTypes.list().map((t) => [t.name, t.displayName]));
    const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '…');
    const range = (r?: string[]) => `${day(r?.[0])} – ${day(r?.[1])}`;
    const chips: { key: FilterKey; label: string }[] = [];
    if (s.searchTypes?.length) chips.push({ key: 'searchTypes', label: `הטקסט רק ב: ${s.searchTypes.map((t) => SEARCH_IN[t] ?? t).join(', ')}` });
    if (s.contentTypes?.length) chips.push({ key: 'contentTypes', label: `סוג תוכן: ${s.contentTypes.map((n) => typeNames.get(n) ?? n).join(', ')}` });
    if (s.labels?.length) chips.push({ key: 'labels', label: `תגיות: ${s.labels.join(', ')}` });
    if (s.colors?.length) chips.push({ key: 'colors', label: `${s.colors.length} צבעים` });
    if (s.users?.length) chips.push({ key: 'users', label: `${s.users.length} כותבים` });
    if (s.folders?.length) chips.push({ key: 'folders', label: `${s.folders.length} תיקיות` });
    if (s.dates?.length) chips.push({ key: 'dates', label: `תאריך האירוע: ${range(s.dates)}` });
    if (s.createdDates?.length) chips.push({ key: 'createdDates', label: `נכתבה: ${range(s.createdDates)}` });
    return chips;
  });

  readonly searchEmpty = computed(() => {
    const s = this.search();
    return !!s && !Object.keys(alertSearch(s)).length;
  });

  /** How many published summaries the search finds right now (null while counting). */
  readonly matchCount = toSignal(
    toObservable(this.search).pipe(
      debounceTime(300),
      switchMap((s) => (s && Object.keys(alertSearch(s)).length ? concat(of(null), this.summaries.count(s).pipe(catchError(() => of(null)))) : of(null))),
    ),
    { initialValue: null },
  );

  /** Opens the search alert's search in the feed. */
  openSearch() {
    const s = this.search();
    if (s) this.router.navigate(['/summaries'], { queryParams: searchToParams(s) });
  }

  private conditionControl(v: INotificationSettingsCondition | null = null) {
    return new FormControl<INotificationSettingsCondition | null>(v);
  }

  private loadRule(id: string) {
    this.loadingRule.set(true);
    this.service.findById(id).subscribe({
      next: (rule) => {
        this.loadingRule.set(false);
        if (!rule) {
          this.router.navigate(['/notifications']);
          return;
        }
        this.creationDate = rule.creationDate;
        const conditions = this.form.controls.conditions;
        conditions.clear();
        for (const c of rule.conditions) conditions.push(this.conditionControl(c));
        this.search.set(rule.search);
        this.form.patchValue({ name: rule.name, isNotify: rule.isNotify, isMail: rule.isMail, isDigest: rule.isDigest, matchAny: !!rule.matchAny });
        this.form.markAsPristine();
      },
      error: () => this.loadingRule.set(false),
    });
  }

  addCondition() {
    this.form.controls.conditions.push(this.conditionControl());
    this.form.markAsDirty();
  }

  removeCondition(i: number) {
    this.form.controls.conditions.removeAt(i);
    this.form.markAsDirty();
  }

  canLeave(): boolean {
    return this.saved || this.form.pristine;
  }

  save() {
    this.submitted.set(true);
    if (this.searchEmpty()) {
      this.message.error('החיפוש ריק: הוסיפו טקסט או תנאי');
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.form.controls.name.markAsDirty();
      return;
    }
    const v = this.form.getRawValue();
    const rule: INotificationSettings = {
      ...(this.id() ? { _id: this.id(), creationDate: this.creationDate } : {}),
      name: v.name.trim(),
      isNotify: v.isNotify,
      isMail: v.isMail,
      isDigest: v.isDigest,
      matchAny: v.matchAny,
      conditions: v.conditions.filter((c): c is INotificationSettingsCondition => !!c),
      ...(this.search() ? { search: this.search() } : {}),
    };
    this.saving.set(true);
    this.service.save(rule).subscribe({
      next: () => {
        this.saved = true;
        this.message.success('הכלל נשמר');
        this.router.navigate(['/notifications']);
      },
      error: () => this.saving.set(false),
    });
  }
}
