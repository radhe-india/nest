// Example data for trying the app without signing in (open the app with ?demo).
// Nothing here is real and nothing is saved.
export const DEFAULT_CATEGORIES = [
  ['rent','Rent & home','spent','home','home','#5A4FF0',1],['groceries','Groceries','spent','home','cart','#1F9D55',2],
  ['food','Food & dining','spent','home','food','#EA6C2B',3],['bills','Bills & subscriptions','spent','home','bolt','#C99412',4],
  ['transport','Transport','spent','home','car','#2F7BEA',5],['shopping','Shopping','spent','home','bag','#D2459B',6],
  ['health','Health','spent','home','heart','#DF4652',7],['travel','Travel','spent','home','plane','#0A95C9',8],
  ['fun','Entertainment','spent','home','film','#0E9F9A',9],['isha','Isha & spiritual','spent','home','lotus','#8D5CF6',10],
  ['milo','Milo','spent','home','paw','#9C6B2E',11],['gifts','Gifts & family','spent','home','gift','#D2459B',12],
  ['other','Other','spent','home','dots','#6B7394',13],
  ['salary','Salary','in','home','wallet','#1F9D55',20],['interest','Interest & dividends','in','home','percent','#0E9F9A',21],
  ['refunds','Refunds & cashback','in','home','refund','#2F7BEA',22],['other_in','Other income','in','home','dots','#6B7394',23],
  ['sip','SIP & mutual funds','saved','home','chart','#4A3DE0',30],['stocks','Stocks','saved','home','up','#0E9F9A',31],
  ['fd','Emergency fund & FD','saved','home','key','#C99412',32],['goal','Towards a goal','saved','home','target','#D2459B',33],
  ['b_fees','Class fees','in','business','lotus','#1F9D55',40],['b_retreats','Retreats','in','business','leaf','#0E9F9A',41],
  ['b_modules','Online modules','in','business','phone','#2F7BEA',42],['b_products','Product sales','in','business','bag','#D2459B',43],
  ['b_other_in','Other business income','in','business','dots','#6B7394',44],['b_inventory','Inventory','spent','business','tag','#C99412',50],
  ['b_venue','Studio & venue','spent','business','home','#5A4FF0',51],['b_marketing','Marketing','spent','business','sparkle','#EA6C2B',52],
  ['b_tools','Software & tools','spent','business','phone','#0A95C9',53],['b_travel','Business travel','spent','business','plane','#8D5CF6',54],
  ['b_other','Other business costs','spent','business','dots','#6B7394',55]
].map(([id, name, kind, scope, icon, color, sort]) => ({ id, name, kind, scope, icon, color, sort, budget: 0, archived: false }));

export function demoSeed() {
  const d = new Date();
  const ym = (k) => { const x = new Date(d.getFullYear(), d.getMonth() - k, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
  const day = (k, dd) => `${ym(k)}-${String(Math.min(dd, 28)).padStart(2, '0')}`;
  const cats = DEFAULT_CATEGORIES.map(c => ({ ...c, budget: { groceries: 12000, food: 8000, bills: 6000, fun: 3000 }[c.id] || 0 }));
  const goals = [
    { id: 'g1', name: 'Car', target: 800000, start_amount: 120000, target_date: null, icon: 'car', color: '#2F7BEA', sort: 0, archived: false },
    { id: 'g2', name: 'Anniversary trip', target: 150000, start_amount: 20000, target_date: null, icon: 'plane', color: '#D2459B', sort: 1, archived: false }
  ];
  const E = [];
  const add = (k, dd, kind, amount, category_id, note, who, extra = {}) => E.push({ id: 'e' + E.length, date: day(k, dd), kind, amount, category_id, note, who, scope: 'home', paid_with: '', source: 'manual', goal_id: null, created_at: new Date().toISOString(), ...extra });
  for (const k of [0, 1, 2]) {
    add(k, 1, 'in', 150000, 'salary', 'Salary', 'me');
    add(k, 2, 'spent', 25000, 'rent', 'Rent', 'joint');
    add(k, 3, 'saved', 15000, 'sip', 'SIP', 'me');
    add(k, 4, 'saved', 5000, 'goal', 'Car fund', 'me', { goal_id: 'g1' });
    add(k, 5, 'spent', 1840, 'groceries', 'Supermarket', 'joint');
    add(k, 8, 'spent', 640, 'food', 'Food delivery', 'trisha');
    add(k, 10, 'spent', 499, 'bills', 'Streaming', 'joint');
    add(k, 12, 'spent', 2350, 'groceries', 'Supermarket', 'trisha');
    add(k, 15, 'spent', 1200, 'fun', 'Movie night', 'joint');
    add(k, 18, 'spent', 3200, 'food', 'Dinner out', 'me');
    add(k, 20, 'in', 6000, 'b_fees', 'Weekend class', 'trisha', { scope: 'business' });
    add(k, 21, 'spent', 1500, 'b_venue', 'Hall booking', 'trisha', { scope: 'business' });
  }
  return {
    categories: cats, goals, entries: E,
    presets: [
      { id: 'p1', label: 'Rent', kind: 'spent', amount: 25000, category_id: 'rent', note: 'Rent', who: 'joint', scope: 'home', sort: 1 },
      { id: 'p2', label: 'Groceries', kind: 'spent', amount: null, category_id: 'groceries', note: 'Supermarket', who: 'joint', scope: 'home', sort: 2 },
      { id: 'p3', label: 'Food delivery', kind: 'spent', amount: null, category_id: 'food', note: 'Food delivery', who: 'joint', scope: 'home', sort: 3 },
      { id: 'p4', label: 'Salary', kind: 'in', amount: null, category_id: 'salary', note: 'Salary', who: 'me', scope: 'home', sort: 4 },
      { id: 'p5', label: 'SIP', kind: 'saved', amount: 15000, category_id: 'sip', note: 'SIP', who: 'me', scope: 'home', sort: 5 }
    ],
    rules: [{ id: 'r1', match: 'blinkit', category_id: 'groceries' }, { id: 'r2', match: 'zomato', category_id: 'food' }],
    settings: [{ key: 'people', value: { me: 'You', trisha: 'Partner' } }, { key: 'paid_with', value: ['Credit card', 'Savings account', 'UPI', 'Cash'] }, { key: 'skip_words', value: [] }],
    members: []
  };
}
