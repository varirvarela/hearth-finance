import { describe, it, expect } from 'vitest';

// ── Verbatim copies of private functions from workers/src/gmail.js ────────────
// These functions are not exported from the worker; this file owns isolated
// copies so that tests do not depend on the module graph of the Cloudflare
// Worker (which imports firebase.js, etc.).

function normalizeAmount(s) {
  const t = s.trim();
  // European: ends with comma + 2 digits (e.g. "25,99" or "1.234,56")
  if (/,\d{2}$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  // US: remove thousands commas
  return parseFloat(t.replace(/,/g, ''));
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Preserve line breaks at block/cell boundaries so item sections stay parseable
    .replace(/<\/?(br|p|div|tr|li|h[1-6]|table|section|article)[^>]*>/gi, '\n')
    .replace(/<\/td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace only
    .replace(/\n[ \t]+/g, '\n')        // trim leading spaces on each line
    .replace(/\n{3,}/g, '\n\n')        // max two consecutive blank lines
    .trim();
}

function b64decode(encoded) {
  return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
}

function extractBody(payload) {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return b64decode(payload.body.data);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return b64decode(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(b64decode(part.body.data));
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractBody(part);
        if (sub) return sub;
      }
    }
  }

  return '';
}

function parseAmazonBody(text) {
  let total       = null;
  let orderNumber = null;
  const items     = [];

  const orderMatch = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
  if (orderMatch) orderNumber = orderMatch[1];

  const totalPatterns = [
    /[Ss]hipment\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Oo]rder\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Gg]rand\s+[Tt]otal\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+[Cc]harged\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    // Spanish
    /[Tt]otal\s+del\s+pedido\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Ii]mporte\s+total\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+a\s+pagar\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    /[Tt]otal\s+del\s+env[íi]o\s*:?\s*(?:[\$€£])?\s*([\d.,]+)/,
    // Generic fallback — "Total: €25,99" or "Total: $25.99"
    /[Tt]otal\s*:?\s*(?:[\$€£])\s*([\d.,]+)/,
  ];
  for (const pat of totalPatterns) {
    const m = text.match(pat);
    if (m) { total = normalizeAmount(m[1]); break; }
  }

  const skip = /total|shipping|handling|\btax\b|subtotal|discount|coupon|savings|gift\s*card|fee|delivery|gastos|impuesto|env[íi]o|amazon|hola|estimad|pedido|enviado|confirma|direcci|address|order\s*#|art[íi]culo|qty|cantidad|units?|unidad/i;

  // Phase 1: items with explicit price (currency symbol present)
  // Allow up to 150 chars for item names (long product titles are common)
  const itemPat = /(.{4,150}?)\s+(?:[\$€£])\s*([\d.,]+)/g;
  let m;
  while ((m = itemPat.exec(text)) !== null) {
    const name  = m[1].trim();
    const price = normalizeAmount(m[2]);
    if (!skip.test(name) && price > 0 && price < 5000 && name.length > 5) {
      items.push({ name, price });
    }
  }

  // Phase 2: if no priced items found, extract names from the shipped-items section.
  // Amazon shipment notifications list item names without per-item prices.
  if (!items.length) {
    // Colon is required — avoids false matches on navigation words like "Shipped", "Ordered"
    const sectionPat = /(?:art[íi]culo|items?\s+(?:in\s+this\s+shipment|ordered|enviados?)|producto)[^:\n]*:\s*\n([\s\S]*?)(?=\n\s*(?:order|total|subtotal|precio|price|importe|tracking|seguimiento|deliver|direcci|address|return\s+by|devoluci))/i;
    const sec = text.match(sectionPat);
    if (sec) {
      const skip2 = /total|shipping|handling|\btax\b|subtotal|fee|delivery|tracking|track\s+your|package|return\s+by|qty|sold\s+by|fulfilled|amazon\.com|condition:|prime|visit/i;
      for (const line of sec[1].split('\n')) {
        // Remove leading quantity patterns: "1 of: ", "2x ", "3 × ", etc.
        const name = line.trim()
          .replace(/^\d+\s*(?:of\s*:?\s*|[×x]\s*)/i, '')
          .replace(/^[\-\*\.\s]+/, '')
          .trim();
        if (
          name.length > 8 && name.length < 200
          && !skip2.test(name)
          && !/^\d+$/.test(name)
          && !/^\d{1,2}\/\d{1,2}/.test(name)
          && !/^https?:/i.test(name)
        ) {
          items.push({ name, price: null });
        }
      }
    }
  }

  return { items, total, orderNumber };
}

// Extract item name(s) from the email subject when the body has none
function extractItemsFromSubject(subject) {
  const m = subject.match(/[Oo]rdered\s+1\s+items?\s*:\s*(.+)/);
  if (m) return [{ name: m[1].trim(), price: null }];
  const m2 = subject.match(/[Hh]as\s+pedido\s+1\s+art[íi]culos?\s*:\s*(.+)/);
  if (m2) return [{ name: m2[1].trim(), price: null }];
  return [];
}

// Extract text/plain body only (no HTML fallback)
function extractTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64decode(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return b64decode(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractTextBody(part);
        if (sub) return sub;
      }
    }
  }
  return '';
}

// Extract and strip HTML body only
function extractHtmlBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) return stripHtml(b64decode(payload.body.data));
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(b64decode(part.body.data));
      if (part.mimeType?.startsWith('multipart/')) {
        const sub = extractHtmlBody(part);
        if (sub) return sub;
      }
    }
  }
  return '';
}

// Simulate parseAmazonEmail logic (without Firebase or network calls)
function parseAmazonEmailLocal(subject, textPlain, htmlBody) {
  const textBody = (textPlain ?? '').replace(/\r\n/g, '\n');
  const { items, total, orderNumber } = parseAmazonBody(textBody);
  if (!total) return null;

  let finalItems = items;
  if (!finalItems.length) finalItems = extractItemsFromSubject(subject);
  if (!finalItems.length && htmlBody) {
    const htmlText = stripHtml(htmlBody).replace(/\r\n/g, '\n');
    const { items: htmlItems } = parseAmazonBody(htmlText);
    finalItems = htmlItems;
  }
  return { items: finalItems, total, orderNumber };
}

// ── normalizeAmount ───────────────────────────────────────────────────────────

describe('normalizeAmount', () => {
  it('parses European format: "25,99" → 25.99', () => {
    expect(normalizeAmount('25,99')).toBe(25.99);
  });

  it('parses European format with dot thousands separator: "1.234,56" → 1234.56', () => {
    expect(normalizeAmount('1.234,56')).toBe(1234.56);
  });

  it('parses US format with comma thousands separator: "1,234.56" → 1234.56', () => {
    expect(normalizeAmount('1,234.56')).toBe(1234.56);
  });

  it('parses plain US decimal: "338.25" → 338.25', () => {
    expect(normalizeAmount('338.25')).toBe(338.25);
  });

  it('strips leading/trailing whitespace before parsing', () => {
    expect(normalizeAmount('  19,99  ')).toBe(19.99);
  });

  it('parses large European amounts: "1.234,00" → 1234', () => {
    expect(normalizeAmount('1.234,00')).toBe(1234);
  });
});

// ── stripHtml ─────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('converts block elements (div, p) to newlines, preserving text on separate lines', () => {
    const result = stripHtml('<div>line1</div><div>line2</div>');
    expect(result).toMatch(/line1\n+line2/);
  });

  it('converts <br> and <tr> to newlines', () => {
    const result = stripHtml('<p>paragraph</p><br>after break');
    expect(result).toMatch(/paragraph\n+after break/);
  });

  it('converts </td> to a space (keeps table cells separated)', () => {
    const result = stripHtml('<td>Cell A</td><td>Cell B</td>');
    expect(result).toMatch(/Cell A\s+Cell B/);
  });

  it('strips inline tags without inserting newlines', () => {
    const result = stripHtml('<strong>bold</strong> and <em>italic</em>');
    expect(result).toBe('bold and italic');
  });

  it('collapses multiple horizontal spaces to one', () => {
    const result = stripHtml('hello    world');
    expect(result).toBe('hello world');
  });

  it('trims leading whitespace from each line after block conversion', () => {
    const result = stripHtml('<div>   indented text</div>');
    const lines  = result.split('\n').filter(l => l.length > 0);
    expect(lines.every(l => !l.startsWith(' '))).toBe(true);
  });

  it('strips <style> blocks entirely (no CSS leaks into output)', () => {
    const result = stripHtml('<style>.foo { color: red; }</style><p>Hello</p>');
    expect(result).not.toContain('.foo');
    expect(result).not.toContain('color');
    expect(result).toContain('Hello');
  });

  it('strips <script> blocks entirely', () => {
    const result = stripHtml('<p>Safe</p><script>alert("xss")</script>');
    expect(result).not.toContain('alert');
    expect(result).toContain('Safe');
  });

  it('decodes &amp; → &', () => {
    expect(stripHtml('Tom &amp; Jerry')).toContain('Tom & Jerry');
  });

  it('decodes &lt; and &gt; → < and >', () => {
    const result = stripHtml('&lt;tag&gt;');
    expect(result).toContain('<tag>');
  });

  it('decodes &nbsp; to a regular space', () => {
    const result = stripHtml('hello&nbsp;world');
    expect(result).toBe('hello world');
  });

  it('collapses 3+ consecutive blank lines to at most 2', () => {
    const result = stripHtml('<div>a</div><div></div><div></div><div></div><div>b</div>');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('trims the entire result (no leading/trailing whitespace)', () => {
    const result = stripHtml('  <div>  text  </div>  ');
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });
});

// ── parseAmazonBody ───────────────────────────────────────────────────────────

describe('parseAmazonBody', () => {

  // Fixture A: US email — item WITH explicit price on same line
  describe('Fixture A — US item with inline price', () => {
    const text = [
      'Items in this shipment:',
      'Acer Chromebook 315 (CB315-4HT-C0SP) $338.25',
      'Order Total: $338.25',
    ].join('\n');

    it('extracts the correct total', () => {
      expect(parseAmazonBody(text).total).toBe(338.25);
    });

    it('extracts exactly one item (phase 1 — price visible)', () => {
      expect(parseAmazonBody(text).items).toHaveLength(1);
    });

    it('item name contains the product name', () => {
      const { items } = parseAmazonBody(text);
      expect(items[0].name).toContain('Acer Chromebook');
    });

    it('item price is parsed correctly', () => {
      expect(parseAmazonBody(text).items[0].price).toBe(338.25);
    });

    it('orderNumber is null when no order number is present', () => {
      expect(parseAmazonBody(text).orderNumber).toBeNull();
    });
  });

  // Fixture B: US shipment notification — item listed WITHOUT per-item price
  describe('Fixture B — US shipment notification (no per-item price)', () => {
    const text = [
      'Items in this shipment:',
      'Acer Chromebook 315 (CB315-4HT-C0SP) 15.6" FHD IPS Touchscreen',
      'Return by October 27, 2026',
      '',
      'Order Total: $338.25',
    ].join('\n');

    it('extracts the correct total', () => {
      expect(parseAmazonBody(text).total).toBe(338.25);
    });

    it('extracts exactly one item (phase 2 — section-based fallback)', () => {
      expect(parseAmazonBody(text).items).toHaveLength(1);
    });

    it('item name contains the product name', () => {
      expect(parseAmazonBody(text).items[0].name).toContain('Acer Chromebook');
    });

    it('item price is null (no per-item price in shipment notification)', () => {
      expect(parseAmazonBody(text).items[0].price).toBeNull();
    });
  });

  // Fixture C: Amazon.es Spanish — European decimal format
  // Note: "Devolver antes del 15 de octubre" is NOT caught by the English-only
  // skip2 list, so the section may yield more than one item. The assertion
  // checks that the Samsung item is present rather than requiring an exact count.
  describe('Fixture C — Amazon.es Spanish with European amounts', () => {
    const text = [
      'Artículo(s) en este envío:',
      'Samsung Galaxy Tab A9 Plus',
      'Devolver antes del 15 de octubre',
      '',
      'Total del pedido: €219,99',
    ].join('\n');

    it('extracts the correct total (European decimal notation)', () => {
      expect(parseAmazonBody(text).total).toBe(219.99);
    });

    it('includes a Samsung item with null price', () => {
      const { items } = parseAmazonBody(text);
      const samsung   = items.find(i => i.name.includes('Samsung'));
      expect(samsung).toBeDefined();
      expect(samsung.price).toBeNull();
    });
  });

  // Fixture D: US email — multiple items each with explicit prices
  describe('Fixture D — Multi-item US order with per-item prices', () => {
    const text = [
      'Items in this shipment:',
      'Acer Chromebook 315 $338.25',
      'USB-C Cable $12.99',
      '',
      'Order Total: $351.24',
    ].join('\n');

    it('extracts the correct total', () => {
      expect(parseAmazonBody(text).total).toBe(351.24);
    });

    it('extracts two items', () => {
      expect(parseAmazonBody(text).items).toHaveLength(2);
    });

    it('all items have numeric prices', () => {
      const { items } = parseAmazonBody(text);
      expect(items.every(i => typeof i.price === 'number')).toBe(true);
    });

    it('individual item prices are correct', () => {
      const { items } = parseAmazonBody(text);
      const chromebook = items.find(i => i.name.includes('Chromebook'));
      const cable      = items.find(i => i.name.includes('USB'));
      expect(chromebook?.price).toBe(338.25);
      expect(cable?.price).toBe(12.99);
    });
  });

  // Fixture E: Order number in the body
  describe('Fixture E — Order number extraction', () => {
    const text = [
      'Order #114-1234567-8901234',
      'Items in this shipment:',
      'Some Product $29.99',
      'Order Total: $29.99',
    ].join('\n');

    it('extracts the order number', () => {
      expect(parseAmazonBody(text).orderNumber).toBe('114-1234567-8901234');
    });

    it('also extracts total correctly', () => {
      expect(parseAmazonBody(text).total).toBe(29.99);
    });

    it('extracts at least one item', () => {
      expect(parseAmazonBody(text).items.length).toBeGreaterThan(0);
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('returns null total when no recognised total pattern is present', () => {
      expect(parseAmazonBody('Some text without any amount.').total).toBeNull();
    });

    it('returns empty items array when no items can be parsed', () => {
      expect(parseAmazonBody('No relevant content.').items).toEqual([]);
    });

    it('returns null orderNumber when no Amazon order number is present', () => {
      expect(parseAmazonBody('Order Total: $10.00').orderNumber).toBeNull();
    });

    it('does not include "Order Total" line as an item', () => {
      const text   = 'Some Item $19.99\nOrder Total: $19.99';
      const { items } = parseAmazonBody(text);
      expect(items.every(i => !/total/i.test(i.name))).toBe(true);
    });

    it('handles Shipment Total as well as Order Total', () => {
      const text = 'Some Item $9.99\nShipment Total: $9.99';
      expect(parseAmazonBody(text).total).toBe(9.99);
    });
  });

  // Regression tests for known bugs
  describe('regression — item extraction bugs', () => {
    it('phase 1: extracts items with names longer than 80 characters', () => {
      // Previously capped at 80 chars; long Chromebook titles were silently dropped
      const longName = 'Acer Chromebook 315 (CB315-4HT-C0SP) 15.6" FHD IPS Touchscreen, 4GB LPDDR4X, 64GB eMMC';
      expect(longName.length).toBeGreaterThan(80);
      const text = `${longName} $338.25\nOrder Total: $338.25`;
      const { items } = parseAmazonBody(text);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].name).toContain('Acer Chromebook');
    });

    it('phase 2: strips "N of: " quantity prefix from item names', () => {
      // Amazon text/plain format: "  1 of: Product Name"
      const text = [
        'Items in this shipment:',
        '  1 of: Acer Chromebook 315 (CB315-4HT-C0SP)',
        '',
        'Order Total: $338.25',
      ].join('\n');
      const { items } = parseAmazonBody(text);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].name).not.toMatch(/^of:/i);
      expect(items[0].name).toContain('Acer Chromebook');
    });

    it('phase 2: strips "Nx" quantity prefix (e.g. "2x Product")', () => {
      const text = [
        'Items in this shipment:',
        '2x USB-C Charging Cable',
        '',
        'Order Total: $12.99',
      ].join('\n');
      const { items } = parseAmazonBody(text);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].name).not.toMatch(/^2x/i);
    });

    it('phase 2: does not include URLs as item names', () => {
      const text = [
        'Items in this shipment:',
        'Some Product',
        'https://www.amazon.com/track/very-long-tracking-link',
        '',
        'Order Total: $29.99',
      ].join('\n');
      const { items } = parseAmazonBody(text);
      expect(items.every(i => !/^https?:/i.test(i.name))).toBe(true);
    });

    it('phase 2: does not include "Track your package:" as an item', () => {
      const text = [
        'Items in this shipment:',
        'Wireless Mouse',
        'Track your package:',
        '',
        'Order Total: $24.99',
      ].join('\n');
      const { items } = parseAmazonBody(text);
      expect(items.every(i => !/track/i.test(i.name))).toBe(true);
    });
  });
});

// ── extractBody ───────────────────────────────────────────────────────────────

describe('extractBody', () => {
  // Helper: standard base64-encode an ASCII string (equivalent to Gmail body.data)
  const enc = (text) => Buffer.from(text).toString('base64');

  it('returns empty string for null payload', () => {
    expect(extractBody(null)).toBe('');
  });

  it('returns empty string for undefined payload', () => {
    expect(extractBody(undefined)).toBe('');
  });

  it('returns empty string when payload has no body.data and no parts', () => {
    expect(extractBody({ mimeType: 'text/plain', body: {} })).toBe('');
  });

  it('decodes a top-level text/plain payload', () => {
    const payload = { mimeType: 'text/plain', body: { data: enc('Hello World') } };
    expect(extractBody(payload)).toBe('Hello World');
  });

  it('prefers text/plain over text/html in multipart alternatives', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: enc('Plain text content') } },
        { mimeType: 'text/html',  body: { data: enc('<p>HTML content</p>') } },
      ],
    };
    expect(extractBody(payload)).toBe('Plain text content');
  });

  it('falls back to text/html (stripped) when no text/plain part exists', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: enc('<p>HTML only</p>') } },
      ],
    };
    const result = extractBody(payload);
    expect(result).toContain('HTML only');
    expect(result).not.toContain('<p>');
  });

  it('recurses into nested multipart parts to find text/plain', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: enc('Nested plain text') } },
          ],
        },
      ],
    };
    expect(extractBody(payload)).toBe('Nested plain text');
  });

  it('handles Gmail URL-safe base64 (- and _ instead of + and /)', () => {
    // Gmail encodes message bodies in URL-safe base64; b64decode must convert.
    const text     = 'Items in this shipment:\nSome Product $99.99\nOrder Total: $99.99';
    const standard = Buffer.from(text).toString('base64');
    const urlSafe  = standard.replace(/\+/g, '-').replace(/\//g, '_');
    const payload  = { mimeType: 'text/plain', body: { data: urlSafe } };
    expect(extractBody(payload)).toBe(text);
  });

  it('returns empty string when parts array is empty', () => {
    expect(extractBody({ mimeType: 'multipart/mixed', parts: [] })).toBe('');
  });
});

// ── extractItemsFromSubject ───────────────────────────────────────────────────

describe('extractItemsFromSubject', () => {
  it('extracts single-item name from "Ordered 1 item: ..." subject', () => {
    const items = extractItemsFromSubject('Ordered 1 item: Skin Care');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Skin Care');
    expect(items[0].price).toBeNull();
  });

  it('extracts long product name from subject', () => {
    const items = extractItemsFromSubject('Ordered 1 item: Acer Chromebook 315 (CB315-4HT-C0SP) 15.6" FHD IPS');
    expect(items).toHaveLength(1);
    expect(items[0].name).toContain('Acer Chromebook');
  });

  it('returns empty array for multi-item subjects', () => {
    expect(extractItemsFromSubject('Ordered 3 items')).toHaveLength(0);
  });

  it('returns empty array for unrelated subjects', () => {
    expect(extractItemsFromSubject('Your Amazon.com order has shipped')).toHaveLength(0);
  });

  it('handles "items" (plural) as well as "item"', () => {
    const items = extractItemsFromSubject('Ordered 1 items: USB Hub');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('USB Hub');
  });

  it('extracts Spanish subject: "Has pedido 1 artículo: ..."', () => {
    const items = extractItemsFromSubject('Has pedido 1 artículo: Samsung Galaxy Tab A9');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Samsung Galaxy Tab A9');
  });
});

// ── Real Amazon email format (from debug output) ──────────────────────────────
// Confirmed via POST /gmail/debug-body: Amazon order confirmation text/plain
// bodies do NOT contain item names. Items appear only in the subject (single
// orders) or in the HTML body (multi-item orders). The body uses \r\n line endings.

describe('Real Amazon email format', () => {
  const enc = (text) => Buffer.from(text).toString('base64');

  // Reproduces the actual text/plain body structure observed via debug-body
  const skinCareBody = [
    '',
    'Your Orders',
    '',
    'https://www.amazon.com/gp/css/order-history',
    '',
    '    Thanks for your order!',
    'Ordered',
    '',
    'Shipped',
    '',
    'Arriving Monday',
    '',
    'Agustina - COS COB, CT',
    '',
    'Order #',
    '114-3696037-2757041',
    '',
    'View or edit order',
    'https://www.amazon.com/your-orders/order-details?orderID=114-3696037-2757041',
    '',
    '',
    'Grand Total:',
    '20.15 USD',
    '',
    '©2026 Amazon.com, Inc.',
  ].join('\r\n');

  it('parses Grand Total from body even when amount is on next line', () => {
    const { total } = parseAmazonBody(skinCareBody.replace(/\r\n/g, '\n'));
    expect(total).toBe(20.15);
  });

  it('parses order number from body', () => {
    const { orderNumber } = parseAmazonBody(skinCareBody.replace(/\r\n/g, '\n'));
    expect(orderNumber).toBe('114-3696037-2757041');
  });

  it('body alone has NO item names (items array is empty)', () => {
    const { items } = parseAmazonBody(skinCareBody.replace(/\r\n/g, '\n'));
    expect(items).toHaveLength(0);
  });

  it('full pipeline: extracts item name from subject when body has none', () => {
    const result = parseAmazonEmailLocal('Ordered 1 item: Skin Care', skinCareBody, null);
    expect(result).not.toBeNull();
    expect(result.total).toBe(20.15);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Skin Care');
  });

  it('full pipeline: extracts Chromebook from subject (long name)', () => {
    const chromebookBody = skinCareBody.replace('20.15 USD', '338.25 USD').replace('114-3696037-2757041', '114-1234567-8901234');
    const result = parseAmazonEmailLocal(
      'Ordered 1 item: Acer Chromebook 315 (CB315-4HT-C0SP) 15.6" FHD IPS',
      chromebookBody,
      null,
    );
    expect(result).not.toBeNull();
    expect(result.total).toBe(338.25);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toContain('Acer Chromebook');
  });

  it('full pipeline: HTML body fallback when text/plain has no items and no single-item subject', () => {
    const html = '<table><tr><td>Acer Chromebook 315</td><td>$338.25</td></tr><tr><td>Order Total:</td><td>$338.25</td></tr></table>';
    const multiItemSubject = 'Ordered 2 items';
    const bodyWithTotal = skinCareBody.replace('20.15 USD', '338.25 USD');
    const result = parseAmazonEmailLocal(multiItemSubject, bodyWithTotal, html);
    expect(result).not.toBeNull();
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].name).toContain('Acer Chromebook');
  });

  it('multipart/alternative payload: prefers text/plain for total, subject for items', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: enc(skinCareBody) } },
        { mimeType: 'text/html',  body: { data: enc('<p>HTML version</p>') } },
      ],
    };
    const textBody = extractTextBody(payload).replace(/\r\n/g, '\n');
    const { total } = parseAmazonBody(textBody);
    expect(total).toBe(20.15);

    const items = extractItemsFromSubject('Ordered 1 item: Skin Care');
    expect(items[0].name).toBe('Skin Care');
  });
});
