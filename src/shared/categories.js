// Two-level category hierarchy for Hearth Finance.
// Groups (parent: null) are containers shown in step 1 of the picker.
// Leaf categories (parent: <groupId>) are the actual tags on transactions.
//
// isFixed  → amount is the same every period (mortgage, phone, gym)
// isAnnual → budgeted on an annual basis, not monthly (insurance, trips, events)
// hide     → kept for data integrity but not shown in the picker

export const CATEGORIES = [
  // ── Groups ──────────────────────────────────────────────────────────────
  { id: 'auto',           name: 'Auto',              parent: null, icon: '🚗', color: '#7c3aed' },
  { id: 'salidas',        name: 'Salidas & Ocio',    parent: null, icon: '🍽️', color: '#d97706' },
  { id: 'utilities',      name: 'Utilities',          parent: null, icon: '⚡', color: '#0284c7' },
  { id: 'super_farmacia', name: 'Super & Farmacia',   parent: null, icon: '🛒', color: '#16a34a' },
  { id: 'adult_act',      name: 'Actividades Adultos',parent: null, icon: '🎾', color: '#0891b2' },
  { id: 'casa',           name: 'Casa',               parent: null, icon: '🏡', color: '#2563eb' },
  { id: 'kids',           name: 'Kids',               parent: null, icon: '👶', color: '#ea580c' },
  { id: 'shopping',         name: 'Shopping',           parent: null, icon: '🛍️', color: '#9333ea' },
  { id: 'suscripciones',   name: 'Suscripciones',     parent: null, icon: '📱', color: '#4f46e5' },
  { id: 'travel',          name: 'Travel',             parent: null, icon: '✈️', color: '#0d9488' },
  { id: 'business',       name: 'Business',           parent: null, icon: '💼', color: '#475569' },
  { id: 'donacion',       name: 'Donación',           parent: null, icon: '❤️', color: '#dc2626' },
  { id: 'cumpleanos',     name: 'Cumpleaños',         parent: null, icon: '🎂', color: '#db2777' },
  { id: 'salud',          name: 'Salud & Bienestar',  parent: null, icon: '🏥', color: '#be185d' },
  { id: 'varios',         name: 'Varios',             parent: null, icon: '📦', color: '#6b7280' },
  { id: 'income_trabajo', name: 'Income — Trabajo',   parent: null, icon: '💰', color: '#15803d', isIncome: true },
  { id: 'income_otros',   name: 'Income — Otros',     parent: null, icon: '📈', color: '#166534', isIncome: true },
  { id: 'transfer',       name: 'Transfer',           parent: null, icon: '↔️', color: '#9ca3af' },

  // ── Auto ────────────────────────────────────────────────────────────────
  { id: 'auto_fijo',          name: 'Cuota del Auto',        parent: 'auto', icon: '🏎️', color: '#6d28d9', isFixed: true,  isAnnual: false,
    description: 'Monthly car loan or lease payment. Fixed recurring amount charged by the lender or dealer.' },
  { id: 'auto_comunes',       name: 'Combustible & Peajes',  parent: 'auto', icon: '⛽', color: '#5b21b6', isFixed: false, isAnnual: false,
    description: 'Gas station fill-ups, EV charging, and highway or bridge tolls. Variable day-to-day driving costs.' },
  { id: 'auto_comunes_anual', name: 'Seguro & Mantenimiento',parent: 'auto', icon: '🔧', color: '#4c1d95', isFixed: false, isAnnual: true,
    description: 'Auto insurance premiums, annual registration, oil changes, tire rotations, and repair shop visits.' },

  // ── Salidas ─────────────────────────────────────────────────────────────
  { id: 'salidas_comunes',  name: 'Restaurantes & Bares',      parent: 'salidas', icon: '🍴', color: '#b45309', isFixed: false, isAnnual: false,
    description: 'Dining out at restaurants, grabbing coffee, and drinks at bars or breweries. Any sit-down or counter service meal paid on-site.' },
  { id: 'salidas_eventos',  name: 'Eventos & Entretenimiento', parent: 'salidas', icon: '🎟️', color: '#92400e', isFixed: false, isAnnual: true,
    description: 'Concert tickets, movies, theater, sporting events, amusement parks, and other one-time entertainment outings.' },
  { id: 'salidas_delivery', name: 'Delivery',                  parent: 'salidas', icon: '🛵', color: '#78350f', isFixed: false, isAnnual: false,
    description: 'Food and grocery delivery services: Uber Eats, DoorDash, Instacart, GrubHub, and similar on-demand delivery apps.' },

  // ── Utilities ───────────────────────────────────────────────────────────
  { id: 'telecom_fijo',      name: 'Teléfono & Internet',  parent: 'utilities', icon: '📡', color: '#0369a1', isFixed: true,  isAnnual: false,
    description: 'Monthly cell phone plan, home internet service, and cable or satellite TV bills. Fixed telecom subscriptions.' },
  { id: 'utilities_comunes', name: 'Luz, Gas & Agua',      parent: 'utilities', icon: '🔌', color: '#075985', isFixed: false, isAnnual: false,
    description: 'Electric, natural gas, and water/sewer bills for the home. Amounts vary by usage and season.' },

  // ── Super y Farmacia ────────────────────────────────────────────────────
  { id: 'super_farmacia_comunes', name: 'Super & Farmacia', parent: 'super_farmacia', icon: '🛒', color: '#15803d', isFixed: false, isAnnual: false,
    description: 'Grocery store purchases (Publix, Whole Foods, Trader Joe\'s, Walmart, Costco) and pharmacy runs (CVS, Walgreens) for household essentials, food, and over-the-counter medication.' },

  // ── Actividades Adultos ─────────────────────────────────────────────────
  { id: 'adult_activities', name: 'Actividades', parent: 'adult_act', icon: '🎾', color: '#0e7490', isFixed: false, isAnnual: true,
    description: 'Sports and leisure activities for adults: tennis, golf, gym memberships, yoga classes, fitness equipment, and club dues.' },

  // ── Casa ────────────────────────────────────────────────────────────────
  { id: 'casa_fijo_mensual',    name: 'Hipoteca & HOA',        parent: 'casa', icon: '🔑', color: '#1d4ed8', isFixed: true,  isAnnual: false,
    description: 'Monthly mortgage payment (principal + interest + escrow) and HOA dues. Fixed recurring housing costs.' },
  { id: 'casa_fijo_anual',      name: 'Seguros del Hogar',     parent: 'casa', icon: '🛡️', color: '#1e40af', isFixed: true,  isAnnual: true,
    description: 'Annual homeowner\'s insurance premium and umbrella policy. May be billed annually or semi-annually.' },
  { id: 'casa_comunes_mensual', name: 'Limpieza & Servicio',   parent: 'casa', icon: '🧹', color: '#1e3a8a', isFixed: false, isAnnual: false,
    description: 'Regular cleaning service, pest control, lawn care, pool service, or any recurring home maintenance vendor paid monthly.' },
  { id: 'casa_comunes_anual',   name: 'Mejoras & Reparaciones',parent: 'casa', icon: '🪚', color: '#172554', isFixed: false, isAnnual: true,
    description: 'Home improvement projects, renovations, appliance replacements, and unplanned repairs (plumber, HVAC, roofer, electrician).' },
  { id: 'casa_mudanza',         name: 'Mudanza',               parent: 'casa', icon: '📦', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true,
    description: 'Moving expenses: movers, truck rental, storage units, and related one-time relocation costs.' },
  { id: 'casa_compra',          name: 'Compra Casa',           parent: 'casa', icon: '🏠', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true,
    description: 'Closing costs, down payment, and one-time fees associated with purchasing a home.' },
  { id: 'casa_obra',            name: 'Obra Casa',             parent: 'casa', icon: '🏗️', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true,
    description: 'Large construction or renovation projects on the home (major remodel, addition, pool build).' },

  // ── Kids ────────────────────────────────────────────────────────────────
  { id: 'kids_activities', name: 'Actividades',   parent: 'kids', icon: '⚽', color: '#c2410c', isFixed: false, isAnnual: true,
    description: 'Extracurricular activities for children: sports leagues, swim lessons, summer camps, music lessons, and enrichment programs.' },
  { id: 'kids_tuition',    name: 'Tuition',        parent: 'kids', icon: '🎓', color: '#9a3412', isFixed: true,  isAnnual: false,
    description: 'Monthly tuition for daycare, preschool, or private school. Fixed recurring charges billed by the school.' },
  { id: 'kids_colegio',    name: 'Colegio & Útiles',parent: 'kids', icon: '📚', color: '#7c2d12', isFixed: false, isAnnual: false,
    description: 'School supplies, uniforms, books, field trips, PTA fees, and other variable school-related expenses.' },

  // ── Shopping ────────────────────────────────────────────────────────────
  { id: 'shopping_comunes', name: 'Shopping', parent: 'shopping', icon: '🛍️', color: '#7e22ce', isFixed: false, isAnnual: false,
    description: 'General retail purchases: clothing, shoes, accessories, electronics, home goods, and online shopping (Amazon, Target, department stores). Anything that is not groceries, pharmacy, or a subscription.' },

  // ── Suscripciones ────────────────────────────────────────────────────────
  { id: 'suscripciones_comunes', name: 'Streaming & Apps', parent: 'suscripciones', icon: '📺', color: '#4338ca', isFixed: true, isAnnual: false,
    description: 'Digital subscriptions billed monthly or annually: Netflix, Spotify, Disney+, Apple One, YouTube Premium, iCloud, Adobe, and similar recurring software or media services.' },

  // ── Travel ──────────────────────────────────────────────────────────────
  { id: 'travel_argentina', name: 'Argentina', parent: 'travel', icon: '🇦🇷', color: '#0f766e', isFixed: false, isAnnual: true,
    description: 'All expenses for trips to Argentina: flights, hotels, Airbnb, dining, transportation, and local activities during the visit.' },
  { id: 'travel_montana',   name: 'Montaña',   parent: 'travel', icon: '⛷️', color: '#115e59', isFixed: false, isAnnual: true,
    description: 'Ski trips and mountain getaways: lift tickets, ski rentals, mountain lodging, and all expenses at ski resorts or mountain destinations.' },
  { id: 'travel_family',    name: 'Familia',   parent: 'travel', icon: '🌴', color: '#134e4a', isFixed: false, isAnnual: true,
    description: 'Family vacation trips: beach holidays, road trips, theme parks, and leisure travel with the whole family.' },
  { id: 'travel_vari',      name: 'Vari',      parent: 'travel', icon: '🗺️', color: '#042f2e', isFixed: false, isAnnual: true,
    description: 'Travel and outings specifically for Vari (one of the children): activities, camps, or trips centered on her.' },
  { id: 'travel_guli',      name: 'Guli',      parent: 'travel', icon: '👶', color: '#022c22', isFixed: false, isAnnual: true,
    description: 'Travel and outings specifically for Guli (one of the children): activities, camps, or trips centered on them.' },

  // ── Business ────────────────────────────────────────────────────────────
  { id: 'business_accenture', name: 'Gastos Accenture', parent: 'business', icon: '💼', color: '#334155', isFixed: false, isAnnual: false,
    description: 'Work-related business expenses reimbursable by Accenture: travel, meals with clients, office supplies, and professional tools.' },
  { id: 'business_realtor',   name: 'Gastos Realtor',   parent: 'business', icon: '🏘️', color: '#1e293b', isFixed: false, isAnnual: false,
    description: 'Real estate business expenses: MLS fees, marketing materials, lockboxes, open house supplies, and other realtor operating costs.' },

  // ── Donación ────────────────────────────────────────────────────────────
  { id: 'donation', name: 'Donación', parent: 'donacion', icon: '🤝', color: '#b91c1c', isFixed: false, isAnnual: false,
    description: 'Charitable donations to nonprofits, churches, GoFundMe campaigns, and similar giving. Includes one-time and recurring pledges.' },

  // ── Cumpleaños ──────────────────────────────────────────────────────────
  { id: 'cumpleanos_comunes', name: 'Regalos & Celebraciones', parent: 'cumpleanos', icon: '🎁', color: '#be185d', isFixed: false, isAnnual: true,
    description: 'Birthday gifts and celebrations for family and friends: presents, party supplies, cakes, and hosting birthday events.' },

  // ── Salud & Bienestar ───────────────────────────────────────────────────
  { id: 'salud_comunes', name: 'Médico & Gastos', parent: 'salud', icon: '🩺', color: '#9d174d', isFixed: false, isAnnual: false,
    description: 'Medical and health expenses: doctor copays, prescription medications, dental and vision visits, lab work, therapist sessions, and health insurance premiums not deducted from payroll.' },

  // ── Varios ──────────────────────────────────────────────────────────────
  { id: 'venmo',            name: 'Venmo',           parent: 'varios', icon: '📱', color: '#4b5563', isFixed: false, isAnnual: false,
    description: 'Peer-to-peer payments sent via Venmo, Zelle, or Cash App. Use for splitting bills, reimbursements, and casual money transfers to friends or family.' },
  { id: 'gastos_argentina', name: 'Gastos Argentina',parent: 'varios', icon: '🇦🇷', color: '#374151', isFixed: false, isAnnual: true, hide: true,
    description: 'Miscellaneous expenses incurred in Argentina not captured under travel: wire transfers, family support, and local bills.' },

  // ── Income — Trabajo ────────────────────────────────────────────────────
  { id: 'paycheck',        name: 'Sueldo',          parent: 'income_trabajo', icon: '💵', color: '#14532d', isIncome: true, isFixed: true,  isAnnual: false,
    description: 'Regular salary or wages: bi-weekly paycheck direct deposits from employer. Fixed recurring income.' },
  { id: 'bonus',           name: 'Bonus',           parent: 'income_trabajo', icon: '🎁', color: '#14532d', isIncome: true, isFixed: false, isAnnual: true,
    description: 'Annual or performance bonus payments from employer. Irregular large deposits labeled as bonus or incentive.' },
  { id: 'compra_acciones', name: 'Acciones / ESPP', parent: 'income_trabajo', icon: '📊', color: '#052e16', isIncome: true, isFixed: false, isAnnual: false,
    description: 'Proceeds from selling company stock, ESPP shares, or RSU vesting events deposited as income.' },
  { id: 'realtor_income',  name: 'Ingresos Realtor',parent: 'income_trabajo', icon: '🏘️', color: '#052e16', isIncome: true, isFixed: false, isAnnual: false,
    description: 'Real estate commission income from property sales or rental management fees.' },

  // ── Income — Otros ──────────────────────────────────────────────────────
  { id: 'income_interest', name: 'Intereses',     parent: 'income_otros', icon: '💹', color: '#15803d', isIncome: true, isFixed: false, isAnnual: false,
    description: 'Interest earned on savings accounts, money market accounts, CDs, Treasury bills, or bond payments. Brokerage and bank interest deposits.' },
  { id: 'income_other',    name: 'Otros Ingresos',parent: 'income_otros', icon: '➕', color: '#14532d', isIncome: true, isFixed: false, isAnnual: false,
    description: 'Any income not covered by other categories: refunds, cashback, reimbursements, tax refunds, or irregular one-off deposits.' },
  { id: 'taxes',           name: 'Impuestos',     parent: 'income_otros', icon: '📋', color: '#052e16', isIncome: true, isFixed: false, isAnnual: true,
    description: 'Tax payments or refunds: federal/state estimated tax payments, IRS payments, and tax refunds received.' },
  { id: 'venta_depto',     name: 'Venta Depto',   parent: 'income_otros', icon: '🏠', color: '#052e16', isIncome: true, isFixed: false, isAnnual: true, hide: true,
    description: 'One-time proceeds from selling a property (apartment or house).' },

  // ── Transfer ────────────────────────────────────────────────────────────
  { id: 'transfer_cuentas', name: 'Entre Cuentas', parent: 'transfer', icon: '🔄', color: '#6b7280', isFixed: false, isAnnual: false,
    description: 'Money moved between your own accounts: checking-to-savings transfers, brokerage funding, ACH pulls between accounts at different banks. Not a real expense — money stays in the household.' },
  { id: 'transfer_tarjeta', name: 'Pago Tarjeta',  parent: 'transfer', icon: '💳', color: '#4b5563', isFixed: false, isAnnual: false,
    description: 'Credit card bill payments made from a checking account. The spend was already recorded when the purchase happened — this is the settlement transfer only.' },

  // ── Catch-all ───────────────────────────────────────────────────────────
  { id: 'uncategorized', name: 'Sin categoría', parent: null, icon: '❓', color: '#d1d5db' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const getCategoryById    = id       => CATEGORY_MAP[id] ?? CATEGORY_MAP.uncategorized;
export const getRootCategories  = ()       => CATEGORIES.filter(c => !c.parent && c.id !== 'uncategorized');
export const getChildCategories = parentId => CATEGORIES.filter(c => c.parent === parentId);
export const getIncomeCategories  = ()     => CATEGORIES.filter(c => c.isIncome);
export const getExpenseCategories = ()     => CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.id !== 'uncategorized');

// Toggle the hide flag on a category at runtime (for per-user visibility preferences).
// Mutates in place — all callers that iterate CATEGORIES see the change immediately.
export function hideCategory(catId, hidden) {
  const cat = CATEGORY_MAP[catId];
  if (cat) cat.hide = !!hidden;
}

// Register a user-defined custom leaf category at runtime.
export function addCustomCategory(catDef) {
  if (CATEGORY_MAP[catDef.id]) return; // never overwrite a built-in
  const cat = { isFixed: false, isAnnual: false, hide: false, isCustom: true, ...catDef };
  CATEGORIES.push(cat);
  CATEGORY_MAP[cat.id] = cat;
}

// Remove a custom category entirely (built-ins must be hidden, not removed).
export function removeCustomCategory(catId) {
  if (!CATEGORY_MAP[catId]?.isCustom) return;
  delete CATEGORY_MAP[catId];
  const idx = CATEGORIES.findIndex(c => c.id === catId);
  if (idx >= 0) CATEGORIES.splice(idx, 1);
}

// Derives the three budget-type fields for a given category id.
// Used by the importer and the enrichment migration script.
export function getCategoryBudgetFields(categoryId) {
  const cat = CATEGORY_MAP[categoryId];
  if (!cat || !cat.parent) return { group: categoryId, isFixed: false, isAnnual: false };
  return {
    group:    cat.parent,
    isFixed:  cat.isFixed  ?? false,
    isAnnual: cat.isAnnual ?? false,
  };
}

// Flat name → id lookup used by the Tiller CSV importer.
export const CATEGORY_NAME_MAP = {
  'Auto Fijo Mensual':                  'auto_fijo',
  'Auto Comunes Mensual':               'auto_comunes',
  'Auto Comunes Anual':                 'auto_comunes_anual',
  'Telecom Fijo Mensual':               'telecom_fijo',
  'Utilities Comunes Mensual':          'utilities_comunes',
  'Salidas Comunes Mensual':            'salidas_comunes',
  'Salidas Eventos Anual':              'salidas_eventos',
  'Super y Farmacia Comunes Mensual':   'super_farmacia_comunes',
  'Adult Activities Comunes Anual':     'adult_activities',
  'Casa Fijo Mensual':                  'casa_fijo_mensual',
  'Casa Fijo Anual':                    'casa_fijo_anual',
  'Casa Comunes Mensual':               'casa_comunes_mensual',
  'Casa Comunes Anual':                 'casa_comunes_anual',
  'Mudanza':                            'casa_mudanza',
  'Compra Casa':                        'casa_compra',
  'Obra Casa':                          'casa_obra',
  'Kids Activities Comunes Anual':      'kids_activities',
  'Tuition':                            'kids_tuition',
  'Shopping Comunes Mensual':           'shopping_comunes',
  'Travel Argentina':                   'travel_argentina',
  'Travel Montaña':                     'travel_montana',
  'Travel Family':                      'travel_family',
  'Travel Vari':                        'travel_vari',
  'Travel Guli':                        'travel_guli',
  'Accenture Expenses':                 'business_accenture',
  'Realtor Expenses':                   'business_realtor',
  'Transfer Cuentas':                   'transfer_cuentas',
  'Pago Tarjeta':                       'transfer_tarjeta',
  'Paycheck':                           'paycheck',
  'Bonus':                              'bonus',
  'Compra Acciones':                    'compra_acciones',
  'Realtor Income':                     'realtor_income',
  'Interest':                           'income_interest',
  'Other Income':                       'income_other',
  'Taxes':                              'taxes',
  'Venta Depto':                        'venta_depto',
  'Donation':                           'donation',
  'Cumpleaños':                         'cumpleanos_comunes',
  'Salud':                              'salud_comunes',
  'Venmo':                              'venmo',
  'Gastos Argentina':                   'gastos_argentina',
};
