import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { format, formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import { ISummarySearch, SearchType } from '../models';
import { CapsuleService } from '../services/capsule.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { highlightHtml, highlightText, regexFor } from './highlight';

/**
 * The match regex for a search, recomputed only when the search, the field or the known capsules change.
 * The highlight pipes are impure so that capsules arriving after the first render still get highlighted.
 */
class RegexMemo {
  private readonly capsules = inject(CapsuleService);
  private last?: { search: unknown; type: unknown; known: unknown; re: RegExp | null };

  get(search: ISummarySearch | null | undefined, type: SearchType | undefined): RegExp | null {
    const known = this.capsules.cache();
    const l = this.last;
    if (l && l.search === search && l.type === type && l.known === known) return l.re;
    const re = type ? regexFor(search, type, this.capsules) : null;
    this.last = { search, type, known, re };
    return re;
  }
}

/** Plain text with search hits wrapped. Output is escaped HTML — bind with [innerHTML]. */
@Pipe({ name: 'highlight', pure: false })
export class HighlightPipe implements PipeTransform {
  private readonly regex = new RegexMemo();
  private last?: { text: unknown; re: RegExp | null; out: string };

  transform(text: string | null | undefined, search: ISummarySearch | null | undefined, type: SearchType): string {
    const re = this.regex.get(search, type);
    let last = this.last;
    if (!last || last.text !== text || last.re !== re) last = this.last = { text, re, out: highlightText(text ?? '', re) };
    return last.out;
  }
}

/**
 * Stored Quill HTML → sanitized (DOMPurify), optionally highlighted, then trusted.
 * Sanitizing first is what makes the trust safe; the old client trusted raw HTML.
 */
@Pipe({ name: 'richHtml', pure: false })
export class RichHtmlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly regex = new RegexMemo();
  private last?: { html: unknown; re: RegExp | null; out: SafeHtml };

  transform(html: string | null | undefined, search?: ISummarySearch | null, type?: SearchType): SafeHtml {
    const re = this.regex.get(search, type);
    let last = this.last;
    if (!last || last.html !== html || last.re !== re) {
      const clean = DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'] });
      last = this.last = { html, re, out: this.sanitizer.bypassSecurityTrustHtml(highlightHtml(clean, re)) };
    }
    return last.out;
  }
}

/**
 * "3 hours ago", or the date and hour when the user prefers exact dates (preferences). Impure so a change of that
 * preference shows at once; the result is memoized per date and mode.
 */
@Pipe({ name: 'relativeTime', pure: false })
export class RelativeTimePipe implements PipeTransform {
  private readonly prefs = inject(PreferencesService);
  private last?: { date: unknown; exact: boolean; out: string };

  transform(date: string | Date | null | undefined): string {
    const exact = this.prefs.exactDates();
    const l = this.last;
    if (l && l.date === date && l.exact === exact) return l.out;
    const d = date ? new Date(date) : null;
    const out = !d || isNaN(d.getTime()) ? '' : exact ? format(d, 'dd/MM/yyyy HH:mm') : formatDistanceToNow(d, { addSuffix: true, locale: he });
    this.last = { date, exact, out };
    return out;
  }
}

@Pipe({ name: 'dateFormat' })
export class DateFormatPipe implements PipeTransform {
  transform(date: string | Date | null | undefined, pattern = 'dd/MM/yyyy HH:mm'): string {
    if (!date) return '';
    const d = new Date(date);
    return isNaN(d.getTime()) ? '' : format(d, pattern);
  }
}

/** Plain-text preview of Quill HTML (cards, tables). */
@Pipe({ name: 'plainText' })
export class PlainTextPipe implements PipeTransform {
  transform(html: string | null | undefined, max = 0): string {
    if (!html) return '';
    const text = new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return max && text.length > max ? text.slice(0, max) + '…' : text;
  }
}
