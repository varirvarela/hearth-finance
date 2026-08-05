// Category taxonomy derived from the family's actual spending structure.
// Groups (parent: null) match the "Group" column from the previous system.
// Leaf categories match the "Category" column.

export const CATEGORIES = [
  // ── Groups ──────────────────────────────────────────────────────────────
  { id: 'auto',           name: 'Auto',             parent: null, icon: '🚗', color: '#7c3aed' },
  { id: 'salidas',        name: 'Salidas',           parent: null, icon: '🍽️', color: '#d97706' },
  { id: 'utilities',      name: 'Utilities',         parent: null, icon: '⚡', color: '#0284c7' },
  { id: 'super_farmacia', name: 'Super y Farmacia',  parent: null, icon: '🛒', color: '#16a34a' },
  { id: 'adult_act',      name: 'Adult Activities',  parent: null, icon: '🎾', color: '#0891b2' },
  { id: 'casa',           name: 'Casa',              parent: null, icon: '🏡', color: '#2563eb' },
  { id: 'kids',           name: 'Kids',              parent: null, icon: '👶', color: '#ea580c' },
  { id: 'shopping',       name: 'Shopping',          parent: null, icon: '🛍️', color: '#9333ea' },
  { id: 'travel',         name: 'Travel',            parent: null, icon: '✈️', color: '#0d9488' },
  { id: 'business',       name: 'Business',          parent: null, icon: '💼', color: '#475569' },
  { id: 'donacion',       name: 'Donation',          parent: null, icon: '❤️', color: '#dc2626' },
  { id: 'cumpleanos',     name: 'Cumpleaños',        parent: null, icon: '🎂', color: '#db2777' },
  { id: 'salud',          name: 'Salud',             parent: null, icon: '🏥', color: '#be185d' },
  { id: 'varios',         name: 'Varios',            parent: null, icon: '📦', color: '#6b7280' },
  { id: 'income_trabajo', name: 'Income Work',       parent: null, icon: '💰', color: '#15803d', isIncome: true },
  { id: 'income_otros',   name: 'Income Non-Work',   parent: null, icon: '📈', color: '#166534', isIncome: true },
  { id: 'transfer',       name: 'Transfer',          parent: null, icon: '↔️', color: '#9ca3af' },

  // ── Auto ────────────────────────────────────────────────────────────────
  { id: 'auto_fijo',         name: 'Auto Fijo Mensual',    parent: 'auto', icon: '🏎️', color: '#6d28d9' },
  { id: 'auto_comunes',      name: 'Auto Comunes Mensual', parent: 'auto', icon: '⛽', color: '#5b21b6' },
  { id: 'auto_comunes_anual',name: 'Auto Comunes Anual',   parent: 'auto', icon: '🔧', color: '#4c1d95' },

  // ── Salidas ─────────────────────────────────────────────────────────────
  { id: 'salidas_comunes',  name: 'Salidas Comunes Mensual', parent: 'salidas', icon: '🍴', color: '#b45309' },
  { id: 'salidas_eventos',  name: 'Salidas Eventos Anual',   parent: 'salidas', icon: '🎟️', color: '#92400e' },

  // ── Utilities ───────────────────────────────────────────────────────────
  { id: 'telecom_fijo',     name: 'Telecom Fijo Mensual',     parent: 'utilities', icon: '📡', color: '#0369a1' },
  { id: 'utilities_comunes',name: 'Utilities Comunes Mensual',parent: 'utilities', icon: '🔌', color: '#075985' },

  // ── Super y Farmacia ────────────────────────────────────────────────────
  { id: 'super_farmacia_comunes', name: 'Super y Farmacia Comunes Mensual', parent: 'super_farmacia', icon: '🛒', color: '#15803d' },

  // ── Adult Activities ────────────────────────────────────────────────────
  { id: 'adult_activities', name: 'Adult Activities Comunes Anual', parent: 'adult_act', icon: '🎾', color: '#0e7490' },

  // ── Casa ────────────────────────────────────────────────────────────────
  { id: 'casa_fijo_mensual',   name: 'Casa Fijo Mensual',   parent: 'casa', icon: '🔑', color: '#1d4ed8' },
  { id: 'casa_fijo_anual',     name: 'Casa Fijo Anual',     parent: 'casa', icon: '🛡️', color: '#1e40af' },
  { id: 'casa_comunes_mensual',name: 'Casa Comunes Mensual',parent: 'casa', icon: '🧹', color: '#1e3a8a' },
  { id: 'casa_comunes_anual',  name: 'Casa Comunes Anual',  parent: 'casa', icon: '🪚', color: '#172554' },
  { id: 'casa_mudanza',        name: 'Mudanza',             parent: 'casa', icon: '📦', color: '#1e3a8a', hide: true },
  { id: 'casa_compra',         name: 'Compra Casa',         parent: 'casa', icon: '🏠', color: '#1e3a8a', hide: true },
  { id: 'casa_obra',           name: 'Obra Casa',           parent: 'casa', icon: '🏗️', color: '#1e3a8a', hide: true },

  // ── Kids ────────────────────────────────────────────────────────────────
  { id: 'kids_activities', name: 'Kids Activities Comunes Anual', parent: 'kids', icon: '⚽', color: '#c2410c' },
  { id: 'kids_tuition',    name: 'Tuition',                       parent: 'kids', icon: '🎓', color: '#9a3412' },

  // ── Shopping ────────────────────────────────────────────────────────────
  { id: 'shopping_comunes', name: 'Shopping Comunes Mensual', parent: 'shopping', icon: '🛍️', color: '#7e22ce' },

  // ── Travel ──────────────────────────────────────────────────────────────
  { id: 'travel_argentina', name: 'Travel Argentina', parent: 'travel', icon: '🇦🇷', color: '#0f766e' },
  { id: 'travel_montana',   name: 'Travel Montaña',   parent: 'travel', icon: '⛷️', color: '#115e59' },
  { id: 'travel_family',    name: 'Travel Family',    parent: 'travel', icon: '🌴', color: '#134e4a' },
  { id: 'travel_vari',      name: 'Travel Vari',      parent: 'travel', icon: '🗺️', color: '#042f2e' },
  { id: 'travel_guli',      name: 'Travel Guli',      parent: 'travel', icon: '👶', color: '#022c22' },

  // ── Business ────────────────────────────────────────────────────────────
  { id: 'business_accenture', name: 'Accenture Expenses', parent: 'business', icon: '💼', color: '#334155' },
  { id: 'business_realtor',   name: 'Realtor Expenses',   parent: 'business', icon: '🏘️', color: '#1e293b' },

  // ── Donation ────────────────────────────────────────────────────────────
  { id: 'donation', name: 'Donation', parent: 'donacion', icon: '🤝', color: '#b91c1c' },

  // ── Cumpleaños ──────────────────────────────────────────────────────────
  { id: 'cumpleanos_comunes', name: 'Cumpleaños', parent: 'cumpleanos', icon: '🎁', color: '#be185d' },

  // ── Salud ───────────────────────────────────────────────────────────────
  { id: 'salud_comunes', name: 'Salud', parent: 'salud', icon: '💊', color: '#9d174d' },

  // ── Varios ──────────────────────────────────────────────────────────────
  { id: 'venmo',           name: 'Venmo',           parent: 'varios', icon: '📱', color: '#4b5563' },
  { id: 'gastos_argentina',name: 'Gastos Argentina',parent: 'varios', icon: '🇦🇷', color: '#374151', hide: true },

  // ── Income Work ─────────────────────────────────────────────────────────
  { id: 'paycheck',         name: 'Paycheck',         parent: 'income_trabajo', icon: '💵', color: '#14532d', isIncome: true },
  { id: 'bonus',            name: 'Bonus',            parent: 'income_trabajo', icon: '🎁', color: '#14532d', isIncome: true },
  { id: 'compra_acciones',  name: 'Compra Acciones',  parent: 'income_trabajo', icon: '📊', color: '#052e16', isIncome: true },
  { id: 'realtor_income',   name: 'Realtor Income',   parent: 'income_trabajo', icon: '🏘️', color: '#052e16', isIncome: true },

  // ── Income Non-Work ─────────────────────────────────────────────────────
  { id: 'income_interest',  name: 'Interest',         parent: 'income_otros', icon: '💹', color: '#15803d', isIncome: true },
  { id: 'income_other',     name: 'Other Income',     parent: 'income_otros', icon: '➕', color: '#14532d', isIncome: true },
  { id: 'taxes',            name: 'Taxes',            parent: 'income_otros', icon: '📋', color: '#052e16', isIncome: true },
  { id: 'venta_depto',      name: 'Venta Depto',      parent: 'income_otros', icon: '🏠', color: '#052e16', isIncome: true, hide: true },

  // ── Transfer ────────────────────────────────────────────────────────────
  { id: 'transfer_cuentas', name: 'Transfer Cuentas', parent: 'transfer', icon: '🔄', color: '#6b7280' },
  { id: 'transfer_tarjeta', name: 'Pago Tarjeta',     parent: 'transfer', icon: '💳', color: '#4b5563' },

  // ── Catch-all ───────────────────────────────────────────────────────────
  { id: 'uncategorized', name: 'Uncategorized', parent: null, icon: '❓', color: '#d1d5db' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const getCategoryById    = id       => CATEGORY_MAP[id] ?? CATEGORY_MAP.uncategorized;
export const getRootCategories  = ()       => CATEGORIES.filter(c => !c.parent && c.id !== 'uncategorized');
export const getChildCategories = parentId => CATEGORIES.filter(c => c.parent === parentId);
export const getIncomeCategories  = ()     => CATEGORIES.filter(c => c.isIncome);
export const getExpenseCategories = ()     => CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer' && c.id !== 'uncategorized');

// Flat name → id lookup used by the CSV importer.
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
