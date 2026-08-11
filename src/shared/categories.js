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
  { id: 'auto_fijo',          name: 'Cuota del Auto',        parent: 'auto', icon: '🏎️', color: '#6d28d9', isFixed: true,  isAnnual: false },
  { id: 'auto_comunes',       name: 'Combustible & Peajes',  parent: 'auto', icon: '⛽', color: '#5b21b6', isFixed: false, isAnnual: false },
  { id: 'auto_comunes_anual', name: 'Seguro & Mantenimiento',parent: 'auto', icon: '🔧', color: '#4c1d95', isFixed: false, isAnnual: true  },

  // ── Salidas ─────────────────────────────────────────────────────────────
  { id: 'salidas_comunes',  name: 'Restaurantes & Bares',      parent: 'salidas', icon: '🍴', color: '#b45309', isFixed: false, isAnnual: false },
  { id: 'salidas_eventos',  name: 'Eventos & Entretenimiento', parent: 'salidas', icon: '🎟️', color: '#92400e', isFixed: false, isAnnual: true  },
  { id: 'salidas_delivery', name: 'Delivery',                  parent: 'salidas', icon: '🛵', color: '#78350f', isFixed: false, isAnnual: false },

  // ── Utilities ───────────────────────────────────────────────────────────
  { id: 'telecom_fijo',      name: 'Teléfono & Internet',  parent: 'utilities', icon: '📡', color: '#0369a1', isFixed: true,  isAnnual: false },
  { id: 'utilities_comunes', name: 'Luz, Gas & Agua',      parent: 'utilities', icon: '🔌', color: '#075985', isFixed: false, isAnnual: false },

  // ── Super y Farmacia ────────────────────────────────────────────────────
  { id: 'super_farmacia_comunes', name: 'Super & Farmacia', parent: 'super_farmacia', icon: '🛒', color: '#15803d', isFixed: false, isAnnual: false },

  // ── Actividades Adultos ─────────────────────────────────────────────────
  { id: 'adult_activities', name: 'Actividades', parent: 'adult_act', icon: '🎾', color: '#0e7490', isFixed: false, isAnnual: true },

  // ── Casa ────────────────────────────────────────────────────────────────
  { id: 'casa_fijo_mensual',    name: 'Hipoteca & HOA',        parent: 'casa', icon: '🔑', color: '#1d4ed8', isFixed: true,  isAnnual: false },
  { id: 'casa_fijo_anual',      name: 'Seguros del Hogar',     parent: 'casa', icon: '🛡️', color: '#1e40af', isFixed: true,  isAnnual: true  },
  { id: 'casa_comunes_mensual', name: 'Limpieza & Servicio',   parent: 'casa', icon: '🧹', color: '#1e3a8a', isFixed: false, isAnnual: false },
  { id: 'casa_comunes_anual',   name: 'Mejoras & Reparaciones',parent: 'casa', icon: '🪚', color: '#172554', isFixed: false, isAnnual: true  },
  { id: 'casa_mudanza',         name: 'Mudanza',               parent: 'casa', icon: '📦', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true },
  { id: 'casa_compra',          name: 'Compra Casa',           parent: 'casa', icon: '🏠', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true },
  { id: 'casa_obra',            name: 'Obra Casa',             parent: 'casa', icon: '🏗️', color: '#1e3a8a', isFixed: false, isAnnual: true,  hide: true },

  // ── Kids ────────────────────────────────────────────────────────────────
  { id: 'kids_activities', name: 'Actividades',   parent: 'kids', icon: '⚽', color: '#c2410c', isFixed: false, isAnnual: true  },
  { id: 'kids_tuition',    name: 'Tuition',        parent: 'kids', icon: '🎓', color: '#9a3412', isFixed: true,  isAnnual: false },
  { id: 'kids_colegio',    name: 'Colegio & Útiles',parent: 'kids', icon: '📚', color: '#7c2d12', isFixed: false, isAnnual: false },

  // ── Shopping ────────────────────────────────────────────────────────────
  { id: 'shopping_comunes',    name: 'Shopping',        parent: 'shopping',       icon: '🛍️', color: '#7e22ce', isFixed: false, isAnnual: false },

  // ── Suscripciones ────────────────────────────────────────────────────────
  { id: 'suscripciones_comunes', name: 'Streaming & Apps', parent: 'suscripciones', icon: '📺', color: '#4338ca', isFixed: true, isAnnual: false },

  // ── Travel ──────────────────────────────────────────────────────────────
  { id: 'travel_argentina', name: 'Argentina', parent: 'travel', icon: '🇦🇷', color: '#0f766e', isFixed: false, isAnnual: true },
  { id: 'travel_montana',   name: 'Montaña',   parent: 'travel', icon: '⛷️', color: '#115e59', isFixed: false, isAnnual: true },
  { id: 'travel_family',    name: 'Familia',   parent: 'travel', icon: '🌴', color: '#134e4a', isFixed: false, isAnnual: true },
  { id: 'travel_vari',      name: 'Vari',      parent: 'travel', icon: '🗺️', color: '#042f2e', isFixed: false, isAnnual: true },
  { id: 'travel_guli',      name: 'Guli',      parent: 'travel', icon: '👶', color: '#022c22', isFixed: false, isAnnual: true },

  // ── Business ────────────────────────────────────────────────────────────
  { id: 'business_accenture', name: 'Gastos Accenture', parent: 'business', icon: '💼', color: '#334155', isFixed: false, isAnnual: false },
  { id: 'business_realtor',   name: 'Gastos Realtor',   parent: 'business', icon: '🏘️', color: '#1e293b', isFixed: false, isAnnual: false },

  // ── Donación ────────────────────────────────────────────────────────────
  { id: 'donation', name: 'Donación', parent: 'donacion', icon: '🤝', color: '#b91c1c', isFixed: false, isAnnual: false },

  // ── Cumpleaños ──────────────────────────────────────────────────────────
  { id: 'cumpleanos_comunes', name: 'Regalos & Celebraciones', parent: 'cumpleanos', icon: '🎁', color: '#be185d', isFixed: false, isAnnual: true },

  // ── Salud & Bienestar ───────────────────────────────────────────────────
  { id: 'salud_comunes', name: 'Médico & Gastos', parent: 'salud', icon: '🩺', color: '#9d174d', isFixed: false, isAnnual: false },

  // ── Varios ──────────────────────────────────────────────────────────────
  { id: 'venmo',            name: 'Venmo',           parent: 'varios', icon: '📱', color: '#4b5563', isFixed: false, isAnnual: false },
  { id: 'gastos_argentina', name: 'Gastos Argentina',parent: 'varios', icon: '🇦🇷', color: '#374151', isFixed: false, isAnnual: true, hide: true },

  // ── Income — Trabajo ────────────────────────────────────────────────────
  { id: 'paycheck',        name: 'Sueldo',          parent: 'income_trabajo', icon: '💵', color: '#14532d', isIncome: true, isFixed: true,  isAnnual: false },
  { id: 'bonus',           name: 'Bonus',           parent: 'income_trabajo', icon: '🎁', color: '#14532d', isIncome: true, isFixed: false, isAnnual: true  },
  { id: 'compra_acciones', name: 'Acciones / ESPP', parent: 'income_trabajo', icon: '📊', color: '#052e16', isIncome: true, isFixed: false, isAnnual: false },
  { id: 'realtor_income',  name: 'Ingresos Realtor',parent: 'income_trabajo', icon: '🏘️', color: '#052e16', isIncome: true, isFixed: false, isAnnual: false },

  // ── Income — Otros ──────────────────────────────────────────────────────
  { id: 'income_interest', name: 'Intereses',     parent: 'income_otros', icon: '💹', color: '#15803d', isIncome: true, isFixed: false, isAnnual: false },
  { id: 'income_other',    name: 'Otros Ingresos',parent: 'income_otros', icon: '➕', color: '#14532d', isIncome: true, isFixed: false, isAnnual: false },
  { id: 'taxes',           name: 'Impuestos',     parent: 'income_otros', icon: '📋', color: '#052e16', isIncome: true, isFixed: false, isAnnual: true  },
  { id: 'venta_depto',     name: 'Venta Depto',   parent: 'income_otros', icon: '🏠', color: '#052e16', isIncome: true, isFixed: false, isAnnual: true,  hide: true },

  // ── Transfer ────────────────────────────────────────────────────────────
  { id: 'transfer_cuentas', name: 'Entre Cuentas', parent: 'transfer', icon: '🔄', color: '#6b7280', isFixed: false, isAnnual: false },
  { id: 'transfer_tarjeta', name: 'Pago Tarjeta',  parent: 'transfer', icon: '💳', color: '#4b5563', isFixed: false, isAnnual: false },

  // ── Catch-all ───────────────────────────────────────────────────────────
  { id: 'uncategorized', name: 'Sin categoría', parent: null, icon: '❓', color: '#d1d5db' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const getCategoryById    = id       => CATEGORY_MAP[id] ?? CATEGORY_MAP.uncategorized;
export const getRootCategories  = ()       => CATEGORIES.filter(c => !c.parent && c.id !== 'uncategorized');
export const getChildCategories = parentId => CATEGORIES.filter(c => c.parent === parentId);
export const getIncomeCategories  = ()     => CATEGORIES.filter(c => c.isIncome);
export const getExpenseCategories = ()     => CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.id !== 'uncategorized');

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
