import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, ElementRef, computed, forwardRef, input, signal, viewChild } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { ICapsule } from '../../../models';
import { capsuleSuggestions } from '../../../services/capsule.service';
import { capsuleIdToken, capsuleTokenId, isCapsuleToken } from '../../../utils/capsules';
import { CapsuleChipComponent } from '../capsule-chip/capsule-chip.component';
import { CapsuleSuggestComponent } from '../capsule-suggest/capsule-suggest.component';

const POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
];

/**
 * Words and capsules as chips. Enter or a comma adds the typed word; `#` starts a capsule (stored as `#cap:<id>`),
 * picked from a list. Backspace in the empty box removes the last chip.
 */
@Component({
  selector: 'app-capsule-words-input',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, NzIconModule, CapsuleChipComponent, CapsuleSuggestComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsule-words-input.component.html',
  styleUrl: './capsule-words-input.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CapsuleWordsInputComponent), multi: true }],
})
export class CapsuleWordsInputComponent implements ControlValueAccessor {
  readonly placeholder = input('מילה + Enter, או # לכמוסה');

  private readonly draftInput = viewChild.required<ElementRef<HTMLInputElement>>('draftInput');

  readonly positions = POSITIONS;
  readonly isCapsule = isCapsuleToken;
  readonly idOf = capsuleTokenId;

  readonly value = signal<string[]>([]);
  readonly draft = signal('');
  readonly focused = signal(false);
  readonly disabled = signal(false);
  /** Escape hides the list until the next keystroke. */
  private readonly dismissed = signal(false);
  readonly active = signal(0);

  /** What follows `#` in the draft; null when not typing a capsule. */
  readonly capsuleQuery = computed(() => {
    const d = this.draft();
    return this.focused() && !this.dismissed() && d.startsWith('#') ? d.slice(1) : null;
  });
  private readonly suggestions = capsuleSuggestions(this.capsuleQuery);
  readonly items = this.suggestions.items;
  readonly loading = this.suggestions.loading;
  readonly open = computed(() => this.capsuleQuery() !== null);

  private onChange: (v: string[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  focus() {
    this.draftInput().nativeElement.focus();
  }

  onDraft(text: string) {
    // A typed or pasted comma ends a word.
    if (text.includes(',') && !text.startsWith('#')) {
      this.add(text.split(','));
      return;
    }
    this.draft.set(text);
    this.dismissed.set(false);
    this.active.set(0);
  }

  onKey(e: KeyboardEvent) {
    const items = this.items();
    if (this.open() && items.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.active.update((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (this.open() && items.length && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      this.pick(items[Math.min(this.active(), items.length - 1)]);
    } else if (this.open() && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.dismissed.set(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.add([this.draft()]);
    } else if (e.key === 'Backspace' && !this.draft() && this.value().length) {
      this.set(this.value().slice(0, -1));
    }
  }

  onBlur() {
    this.focused.set(false);
    if (!this.draft().startsWith('#')) this.add([this.draft()]);
    this.onTouched();
  }

  pick(c: ICapsule) {
    const token = capsuleIdToken(c._id);
    if (!this.value().includes(token)) this.set([...this.value(), token]);
    this.draft.set('');
    this.active.set(0);
  }

  remove(w: string) {
    this.set(this.value().filter((x) => x !== w));
  }

  private add(words: string[]) {
    const fresh = words.map((w) => w.trim()).filter((w) => w && !this.value().includes(w));
    this.draft.set('');
    if (fresh.length) this.set([...this.value(), ...new Set(fresh)]);
  }

  private set(v: string[]) {
    this.value.set(v);
    this.onChange(v);
  }

  // ---- ControlValueAccessor ----
  writeValue(v: string[] | null): void {
    this.value.set(v ?? []);
  }
  registerOnChange(fn: (v: string[]) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
