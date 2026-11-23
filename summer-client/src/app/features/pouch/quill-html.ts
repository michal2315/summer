/** Quill size classes → the point sizes the Pouch editor offers. */
const QUILL_SIZES: Record<string, string> = { small: '9pt', large: '14pt', huge: '20pt' };

/**
 * Summary content is Quill 2 HTML: every list is an `<ol>` whose items say `data-list="bullet|ordered"`, alignment and
 * sizes are classes, and the list markers are UI spans. Rewrite it as plain HTML that the Tiptap schema reads: real
 * `<ul>`/`<ol>`, inline text-align and font-size styles, no UI spans, mentions as their text.
 */
export function quillToHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;

  body.querySelectorAll('.ql-ui').forEach((el) => el.remove());
  body.querySelectorAll('span.mention').forEach((el) => el.replaceWith(doc.createTextNode(el.textContent ?? '')));

  body.querySelectorAll<HTMLElement>('[class*="ql-align-"]').forEach((el) => {
    const m = /ql-align-(center|right|left|justify)/.exec(el.className);
    if (m) el.style.textAlign = m[1];
  });
  body.querySelectorAll<HTMLElement>('[class*="ql-size-"]').forEach((el) => {
    const m = /ql-size-(small|large|huge)/.exec(el.className);
    if (m) el.style.fontSize = QUILL_SIZES[m[1]];
  });

  // Each run of same-kind items becomes its own list; ql-indent-N nests an item N levels deep.
  body.querySelectorAll('ol').forEach((ol) => {
    if (!ol.querySelector(':scope > li[data-list]')) return;
    const frag = doc.createDocumentFragment();
    let stack: { list: HTMLElement; kind: string }[] = [];
    for (const li of Array.from(ol.children) as HTMLElement[]) {
      const kind = li.getAttribute('data-list') === 'bullet' ? 'ul' : 'ol';
      const depth = Number(/ql-indent-(\d)/.exec(li.className)?.[1] ?? 0);
      stack = stack.slice(0, depth + 1);
      while (stack.length < depth + 1) {
        const list = doc.createElement(kind);
        const parentLi = stack.at(-1)?.list.lastElementChild;
        if (parentLi) parentLi.appendChild(list);
        else frag.appendChild(list);
        stack.push({ list, kind });
      }
      if (stack[depth].kind !== kind) {
        const list = doc.createElement(kind);
        const parentLi = depth > 0 ? stack[depth - 1].list.lastElementChild : null;
        if (parentLi) parentLi.appendChild(list);
        else frag.appendChild(list);
        stack[depth] = { list, kind };
      }
      const item = doc.createElement('li');
      item.innerHTML = li.innerHTML;
      if (li.style.textAlign) item.style.textAlign = li.style.textAlign;
      stack[depth].list.appendChild(item);
    }
    ol.replaceWith(frag);
  });

  body.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
  return body.innerHTML;
}
