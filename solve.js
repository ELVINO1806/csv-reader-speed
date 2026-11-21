// Fast drop-in for csv-reader 1.0.0: same answers, indexOf/slice scanning instead of
// char-at-a-time concatenation. Semantics mirror vendor/csv-reader/index.js exactly.
const COMMA = 0, LINE_BREAK = 1, END = 2;
const DELIM = /[,\r\n]/g;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Read an unquoted field starting at pos, appending onto `value`.
  // Returns [value, ended, added] where added counts kept characters.
  function readUnquoted(value) {
    let added = 0;
    let start = pos;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      const i = m ? m.index : -1;
      const kind = m ? (m[0] === ',' ? 0 : m[0] === '\n' ? 1 : 2) : -1;
      if (i === -1) {
        if (pos < n) { value += text.slice(start); added += n - start; }
        pos = n;
        return [value, END, added];
      }
      if (kind === 0) {
        value += text.slice(start, i); added += i - start;
        pos = i + 1;
        return [value, COMMA, added];
      }
      if (kind === 1) {
        value += text.slice(start, i); added += i - start;
        pos = i + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // kind === 2: CR
      if (text.charCodeAt(i + 1) === 10) {
        value += text.slice(start, i); added += i - start;
        pos = i + 2;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // stray CR: dropped, error, field continues
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += text.slice(start, i); added += i - start;
      pos = i + 1;
      start = pos;
    }
  }

  // Count line breaks in a quoted segment already converted to \n form.
  function countLF(s) {
    let c = 0, p = s.indexOf('\n');
    while (p !== -1) { c++; p = s.indexOf('\n', p + 1); }
    return c;
  }

  // Read a quoted field whose opening quote is at pos. Returns [value, ended, added].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1; // scan cursor inside quotes
    let start = p;   // start of current segment inside quotes
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // Never closes: literal quote, re-read as unquoted from after the open quote.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote. Segment may hold line breaks.
        const seg = text.slice(start, q);
        if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
          const conv = seg.replace(/\r\n?/g, '\n');
          line += countLF(conv);
          value += conv;
        } else {
          value += seg;
        }
        value += '"';
        p = q + 2;
        start = q + 2;
        continue;
      }
      // Closing quote at q.
      const seg = text.slice(start, q);
      if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
        const conv = seg.replace(/\r\n?/g, '\n');
        line += countLF(conv);
        value += conv;
      } else {
        value += seg;
      }
      pos = q + 1;
      if (pos >= n) return [value, END, 0];
      const c = text.charCodeAt(pos);
      if (c === 44) { pos += 1; return [value, COMMA, 0]; }
      if (c === 10) { pos += 1; line += 1; return [value, LINE_BREAK, 0]; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; return [value, LINE_BREAK, 0]; }
      // Junk after the closing quote, appended as it stands.
      const junk = readUnquoted(value);
      if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field, quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field[0]);
    } while (field[1] === COMMA);

    // A line left with no characters is no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
