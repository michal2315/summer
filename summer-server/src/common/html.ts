import { decodeHTML } from 'entities';
import sanitizeHtml from 'sanitize-html';

/** Allow-list matching what the client's Quill 2 editor produces (formats, lists, RTL/alignment classes, links, images). */
const QUILL_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup',
    'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'span', 'img', 'hr',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
  ],
  allowedAttributes: {
    '*': ['class', 'dir'],
    a: ['href', 'target', 'rel'],
    li: ['data-list'],
    img: ['src', 'alt', 'width', 'height'],
    pre: ['spellcheck', 'data-language'],
    span: ['style', 'contenteditable', 'data-*'],
    td: ['colspan', 'rowspan', 'data-row'],
  },
  allowedClasses: { '*': ['ql-*', 'mention'] },
  allowedStyles: {
    span: {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: 'noopener noreferrer' } }),
  },
};

export function sanitizeQuill(html: string | undefined | null): string {
  return sanitizeHtml(html ?? '', QUILL_OPTIONS).trim();
}

/** Readable text for search and Excel: tags → spaces, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
  const stripped = sanitizeHtml(html.replace(/<(br|\/p|\/h\d|\/li|\/div|\/tr)\b[^>]*>/gi, ' $&'), { allowedTags: [], allowedAttributes: {} });
  return decodeHTML(stripped).replace(/\s+/g, ' ').trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
