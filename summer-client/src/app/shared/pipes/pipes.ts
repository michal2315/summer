import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { format, formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import DOMPurify from 'dompurify';
import { ISummarySearch, SearchType } from '../models';
import { highlightHtml, highlightText, regexFor } from './highlight';

/** Plain text with search hits wrapped. Output is escaped HTML — bind with [innerHTML]. */
@Pipe({ name: 'highlight' })
export class HighlightPipe implements PipeTransform {
  transform(text: string | null | undefined, search: ISummarySearch | null | undefined, type: SearchType): string {
    return highlightText(text ?? '', regexFor(search, type));
  }
}

/**
 * Stored Quill HTML → sanitized (DOMPurify), optionally highlighted, then trusted.
 * Sanitizing first is what makes the trust safe; the old client trusted raw HTML.
 */
@Pipe({ name: 'richHtml' })
export class RichHtmlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(html: string | null | undefined, search?: ISummarySearch | null, type?: SearchType): SafeHtml {
    const clean = DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'] });
    const re = type ? regexFor(search, type) : null;
    return this.sanitizer.bypassSecurityTrustHtml(highlightHtml(clean, re));
  }
}

@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(date: string | Date | null | undefined): string {
    return date ? formatDistanceToNow(new Date(date), { addSuffix: true, locale: he }) : '';
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
