export const CATEGORIES = [
  // Income
  { id: 'income',              name: 'Income',             parent: null,        isIncome: true,  icon: '💰', color: '#22c55e' },
  { id: 'income_salary',       name: 'Salary & Wages',     parent: 'income',    isIncome: true,  icon: '💼', color: '#16a34a' },
  { id: 'income_freelance',    name: 'Freelance',          parent: 'income',    isIncome: true,  icon: '🖥️', color: '#15803d' },
  { id: 'income_invest',       name: 'Investment Income',  parent: 'income',    isIncome: true,  icon: '📈', color: '#166534' },
  { id: 'income_rental',       name: 'Rental Income',      parent: 'income',    isIncome: true,  icon: '🏠', color: '#14532d' },
  { id: 'income_other',        name: 'Other Income',       parent: 'income',    isIncome: true,  icon: '➕', color: '#052e16' },

  // Housing
  { id: 'housing',             name: 'Housing',            parent: null,        icon: '🏡', color: '#3b82f6' },
  { id: 'housing_rent',        name: 'Rent / Mortgage',    parent: 'housing',   icon: '🔑', color: '#2563eb' },
  { id: 'housing_hoa',         name: 'HOA Fees',           parent: 'housing',   icon: '🏘️', color: '#1d4ed8' },
  { id: 'housing_tax',         name: 'Property Tax',       parent: 'housing',   icon: '📋', color: '#1e40af' },
  { id: 'housing_insurance',   name: 'Home Insurance',     parent: 'housing',   icon: '🛡️', color: '#1e3a8a' },
  { id: 'housing_repairs',     name: 'Maintenance',        parent: 'housing',   icon: '🔧', color: '#172554' },
  { id: 'utilities',           name: 'Utilities',          parent: 'housing',   icon: '⚡', color: '#0ea5e9' },
  { id: 'utilities_electric',  name: 'Electric',           parent: 'utilities', icon: '💡', color: '#0284c7' },
  { id: 'utilities_gas',       name: 'Gas',                parent: 'utilities', icon: '🔥', color: '#0369a1' },
  { id: 'utilities_water',     name: 'Water',              parent: 'utilities', icon: '💧', color: '#075985' },
  { id: 'utilities_internet',  name: 'Internet',           parent: 'utilities', icon: '📡', color: '#0c4a6e' },
  { id: 'utilities_phone',     name: 'Phone',              parent: 'utilities', icon: '📱', color: '#082f49' },

  // Food
  { id: 'food',                name: 'Food & Drink',       parent: null,        icon: '🍽️', color: '#f59e0b' },
  { id: 'food_groceries',      name: 'Groceries',          parent: 'food',      icon: '🛒', color: '#d97706' },
  { id: 'food_dining',         name: 'Restaurants',        parent: 'food',      icon: '🍴', color: '#b45309' },
  { id: 'food_coffee',         name: 'Coffee & Cafes',     parent: 'food',      icon: '☕', color: '#92400e' },
  { id: 'food_delivery',       name: 'Food Delivery',      parent: 'food',      icon: '🛵', color: '#78350f' },

  // Transportation
  { id: 'transport',           name: 'Transportation',     parent: null,        icon: '🚗', color: '#8b5cf6' },
  { id: 'transport_car',       name: 'Car Payment',        parent: 'transport', icon: '🏎️', color: '#7c3aed' },
  { id: 'transport_insurance', name: 'Auto Insurance',     parent: 'transport', icon: '🛡️', color: '#6d28d9' },
  { id: 'transport_gas',       name: 'Gas & Fuel',         parent: 'transport', icon: '⛽', color: '#5b21b6' },
  { id: 'transport_parking',   name: 'Parking',            parent: 'transport', icon: '🅿️', color: '#4c1d95' },
  { id: 'transport_transit',   name: 'Public Transit',     parent: 'transport', icon: '🚇', color: '#3b0764' },
  { id: 'transport_rideshare', name: 'Ride Share',         parent: 'transport', icon: '🚕', color: '#2e1065' },

  // Healthcare
  { id: 'health',              name: 'Healthcare',         parent: null,        icon: '🏥', color: '#ec4899' },
  { id: 'health_insurance',    name: 'Health Insurance',   parent: 'health',    icon: '📋', color: '#db2777' },
  { id: 'health_doctor',       name: 'Doctor & Dentist',   parent: 'health',    icon: '👨‍⚕️', color: '#be185d' },
  { id: 'health_rx',           name: 'Prescriptions',      parent: 'health',    icon: '💊', color: '#9d174d' },
  { id: 'health_fitness',      name: 'Gym & Fitness',      parent: 'health',    icon: '💪', color: '#831843' },

  // Personal
  { id: 'personal',            name: 'Personal',           parent: null,        icon: '👤', color: '#64748b' },
  { id: 'personal_clothing',   name: 'Clothing',           parent: 'personal',  icon: '👗', color: '#475569' },
  { id: 'personal_care',       name: 'Personal Care',      parent: 'personal',  icon: '🧴', color: '#334155' },
  { id: 'personal_hair',       name: 'Haircuts',           parent: 'personal',  icon: '✂️', color: '#1e293b' },

  // Entertainment
  { id: 'entertainment',           name: 'Entertainment',      parent: null,            icon: '🎮', color: '#06b6d4' },
  { id: 'entertainment_streaming', name: 'Streaming',           parent: 'entertainment', icon: '📺', color: '#0891b2' },
  { id: 'entertainment_events',    name: 'Events & Concerts',   parent: 'entertainment', icon: '🎟️', color: '#0e7490' },
  { id: 'entertainment_hobbies',   name: 'Hobbies',             parent: 'entertainment', icon: '🎨', color: '#155e75' },
  { id: 'entertainment_books',     name: 'Books & Education',   parent: 'entertainment', icon: '📚', color: '#164e63' },

  // Children
  { id: 'children',             name: 'Children',           parent: null,        icon: '👶', color: '#f97316' },
  { id: 'children_childcare',   name: 'Childcare',          parent: 'children',  icon: '🧒', color: '#ea580c' },
  { id: 'children_tuition',     name: 'Tuition',            parent: 'children',  icon: '🎓', color: '#c2410c' },
  { id: 'children_supplies',    name: 'School Supplies',    parent: 'children',  icon: '📐', color: '#9a3412' },
  { id: 'children_activities',  name: 'Activities',         parent: 'children',  icon: '⚽', color: '#7c2d12' },

  // Shopping
  { id: 'shopping',             name: 'Shopping',           parent: null,        icon: '🛍️', color: '#a855f7' },
  { id: 'shopping_online',      name: 'Online Shopping',    parent: 'shopping',  icon: '📦', color: '#9333ea' },
  { id: 'shopping_electronics', name: 'Electronics',        parent: 'shopping',  icon: '💻', color: '#7e22ce' },
  { id: 'shopping_home',        name: 'Home & Garden',      parent: 'shopping',  icon: '🌱', color: '#6b21a8' },

  // Travel
  { id: 'travel',               name: 'Travel',             parent: null,        icon: '✈️', color: '#14b8a6' },
  { id: 'travel_flights',       name: 'Flights',            parent: 'travel',    icon: '🛫', color: '#0d9488' },
  { id: 'travel_hotels',        name: 'Hotels',             parent: 'travel',    icon: '🏨', color: '#0f766e' },
  { id: 'travel_vacation',      name: 'Vacation',           parent: 'travel',    icon: '🌴', color: '#115e59' },

  // Financial
  { id: 'financial',            name: 'Financial',          parent: null,        icon: '🏦', color: '#6b7280' },
  { id: 'financial_savings',    name: 'Savings Transfer',   parent: 'financial', icon: '🏧', color: '#4b5563' },
  { id: 'financial_invest',     name: 'Investment',         parent: 'financial', icon: '📊', color: '#374151' },
  { id: 'financial_loans',      name: 'Loan Payment',       parent: 'financial', icon: '💳', color: '#1f2937' },
  { id: 'financial_fees',       name: 'Bank Fees',          parent: 'financial', icon: '🏧', color: '#111827' },

  // Giving
  { id: 'giving',               name: 'Giving',             parent: null,        icon: '❤️', color: '#ef4444' },
  { id: 'giving_charity',       name: 'Charity',            parent: 'giving',    icon: '🤝', color: '#dc2626' },
  { id: 'giving_gifts',         name: 'Gifts',              parent: 'giving',    icon: '🎁', color: '#b91c1c' },

  // Transfers (internal moves between own accounts — net-neutral for budgets)
  { id: 'transfer',             name: 'Transfer',           parent: null,        icon: '↔️', color: '#9ca3af' },

  // Catch-all
  { id: 'uncategorized',        name: 'Uncategorized',      parent: null,        icon: '❓', color: '#d1d5db' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const getCategoryById    = id       => CATEGORY_MAP[id] ?? CATEGORY_MAP.uncategorized;
export const getRootCategories  = ()       => CATEGORIES.filter(c => !c.parent && c.id !== 'uncategorized');
export const getChildCategories = parentId => CATEGORIES.filter(c => c.parent === parentId);
export const getIncomeCategories = ()      => CATEGORIES.filter(c => c.isIncome);
export const getExpenseCategories = ()     => CATEGORIES.filter(c => !c.isIncome && c.id !== 'transfer');
