// One-time manual categorization patch based on transaction review.
// Writes to suggestions/${UID}/ — user still confirms in the app.
// Run: node scripts/patch-manual-categorize.js

import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase }         from 'firebase-admin/database';
import { readFileSync }        from 'fs';
import { resolve, dirname }    from 'path';
import { fileURLToPath }       from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sa   = JSON.parse(readFileSync(resolve(root, 'service-account.json'), 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: 'https://hearth-finance-9830c-default-rtdb.firebaseio.com' });

const db  = getDatabase();
const UID = 'M8n6Fow8QcUm5DLLmE0aIajNNr72';

// ── Rules: [regex, catId, confidence, hint] ───────────────────────────────────
// Order matters — first match wins.
const RULES = [
  // ── Income ──────────────────────────────────────────────────────────────────
  [/ubs.*finsvc|finsvc.*dps/i,                                    'income_other',          0.90, 'UBS investment/brokerage credit'],
  [/ach.*credit.*stubhub|stubhub.*cons.*payment/i,               'income_other',          0.85, 'StubHub sale proceeds'],
  [/bond interest|security redeemed/i,                           'income_interest',       0.95, 'investment/bond income'],
  [/irs.*treas.*310|treas.*310.*tax/i,                           'taxes',                 0.99, 'IRS tax refund'],
  [/zelle payment from/i,                                         'income_other',          0.85, 'Zelle received from another person'],
  [/return of posted check/i,                                     'income_other',          0.90, 'returned/reversed check'],
  [/stubhub credit.*year|dining credit.*year/i,                  'income_other',          0.80, 'credit card annual benefit'],

  // ── Transfers ───────────────────────────────────────────────────────────────
  [/zelle payment to|zelle debitpay|zelle debit/i,               'transfer_cuentas',      0.95, 'Zelle outgoing payment'],
  [/discover e.?payment/i,                                        'transfer_tarjeta',      0.97, 'Discover credit card payment'],
  [/online.*scheduled payment.*acct/i,                           'transfer_tarjeta',      0.97, 'scheduled credit card payment'],
  [/online payment.?thank you/i,                                  'transfer_tarjeta',      0.95, 'credit card payment'],
  [/ach.*electronic.*debit.*chase/i,                             'transfer_tarjeta',      0.95, 'Chase credit card payment'],
  [/ach.*debit.*discover/i,                                      'transfer_tarjeta',      0.95, 'Discover credit card payment'],
  [/ach.*debit.*pac.?life|pac.?life.*insur/i,                   'auto_comunes_anual',    0.88, 'Pacific Life insurance premium'],
  [/outgoing.*wire transfer|incoming.*wire transfer/i,           'transfer_cuentas',      0.97, 'bank wire transfer'],
  [/outgoing domestic wire|mobile.*wire/i,                       'transfer_cuentas',      0.95, 'domestic wire transfer'],
  [/cash withdrawal/i,                                            'transfer_cuentas',      0.90, 'ATM / bank cash withdrawal'],
  [/citibank.*deposit/i,                                          'transfer_cuentas',      0.90, 'Citibank inter-account deposit'],

  // ── Airlines ────────────────────────────────────────────────────────────────
  [/jetblue|jet blue/i,                                           'travel_vari',           0.99, 'JetBlue Airlines'],
  [/frontier ai[^r]|frontier.*airlines/i,                        'travel_vari',           0.99, 'Frontier Airlines'],
  [/american air/i,                                               'travel_vari',           0.99, 'American Airlines'],
  [/arajet/i,                                                     'travel_vari',           0.99, 'Arajet airline'],
  [/mem rwds airline/i,                                           'travel_vari',           0.85, 'airline credit card reward fee'],

  // ── Car Rental / Hotels / Travel ────────────────────────────────────────────
  [/enterprise rent|enterprise.*car/i,                           'travel_vari',           0.98, 'Enterprise car rental'],
  [/avis rent.?a.?car|etoll avis|alamo toll/i,                  'travel_vari',           0.95, 'Avis / Alamo car rental'],
  [/sixt\.com|^sixt\s/i,                                         'travel_vari',           0.97, 'Sixt car rental'],
  [/the westin\b|westin\s/i,                                     'travel_vari',           0.97, 'Westin hotel'],
  [/san francisco marrio/i,                                       'travel_vari',           0.97, 'Marriott hotel SF'],
  [/renaissance.*cincin/i,                                       'travel_vari',           0.97, 'Renaissance hotel'],
  [/cozysuites/i,                                                 'travel_vari',           0.90, 'hotel / short-term rental'],
  [/priceln.*tvl|priceline.*travel/i,                            'travel_vari',           0.90, 'Priceline travel insurance'],
  [/travel impressions/i,                                         'travel_vari',           0.90, 'travel agency / package'],
  [/edreams/i,                                                    'travel_vari',           0.90, 'eDreams travel booking'],
  [/palms\b/i,                                                    'travel_vari',           0.85, 'hotel (Palms)'],
  [/u.?haul/i,                                                    'travel_vari',           0.90, 'U-Haul truck/storage'],

  // ── Parking / Transit / Auto ─────────────────────────────────────────────────
  [/parkmobile/i,                                                 'auto_comunes',          0.99, 'ParkMobile parking app'],
  [/parkfast/i,                                                   'auto_comunes',          0.99, 'Parkfast parking'],
  [/valet park of america/i,                                      'auto_comunes',          0.97, 'valet parking'],
  [/abm \d{4} broadway|abm.*park/i,                              'auto_comunes',          0.95, 'ABM parking'],
  [/marta tap and go/i,                                           'auto_comunes',          0.99, 'MARTA Atlanta transit'],
  [/citibik/i,                                                    'auto_comunes',          0.99, 'Citi Bike'],
  [/lyft\b.*rides?/i,                                             'auto_comunes',          0.99, 'Lyft rideshare'],
  [/pride station/i,                                              'auto_comunes',          0.90, 'gas station (Pride)'],
  [/village of lindenhurst p/i,                                   'auto_comunes',          0.85, 'parking / municipal fee'],
  [/metro\b/i,                                                    'auto_comunes',          0.80, 'metro / transit'],
  [/mazda.*white plain/i,                                         'auto_comunes_anual',    0.90, 'Mazda car service / dealer'],

  // ── Restaurants ─────────────────────────────────────────────────────────────
  // TST* = Toast POS — almost always a sit-down restaurant
  [/tst[\* ]/i,                                                   'salidas_comunes',       0.92, 'restaurant (Toast POS)'],
  [/tinas grille/i,                                               'salidas_comunes',       0.98, 'restaurant'],
  [/lucky buns/i,                                                 'salidas_comunes',       0.97, 'restaurant'],
  [/\bcava\b/i,                                                   'salidas_comunes',       0.98, 'Cava restaurant'],
  [/p\.?f\.?chang/i,                                             'salidas_comunes',       0.99, 'P.F. Chang\'s restaurant'],
  [/macaroni grill/i,                                             'salidas_comunes',       0.99, 'Macaroni Grill restaurant'],
  [/chick.?fil.?a/i,                                             'salidas_comunes',       0.99, 'Chick-fil-A'],
  [/sweetgreen/i,                                                 'salidas_comunes',       0.99, 'Sweetgreen salad restaurant'],
  [/stone fire/i,                                                 'salidas_comunes',       0.90, 'Stonefire restaurant'],
  [/sarku japan/i,                                                'salidas_comunes',       0.97, 'Sarku Japan restaurant'],
  [/acai brazil/i,                                                'salidas_comunes',       0.95, 'Acai Brazil restaurant'],
  [/bakan bars/i,                                                 'salidas_comunes',       0.95, 'Bakan Bars restaurant'],
  [/wdw (dining|akershus|abc commissary|catalina|cosmic ray|france cart|combo cart|popcorn|fast food)/i, 'salidas_comunes', 0.95, 'Disney park dining'],
  [/honeydukes/i,                                                 'salidas_comunes',       0.90, 'Universal Harry Potter food'],
  [/vine italian ice/i,                                           'salidas_comunes',       0.92, 'food/snack vendor'],
  [/frosty moon|moonship choc/i,                                  'salidas_comunes',       0.90, 'snack/dessert vendor'],
  [/radiocity.*food|radiocityfood/i,                             'salidas_comunes',       0.90, 'Radio City Music Hall food'],
  [/dal stadium concession/i,                                     'salidas_comunes',       0.95, 'stadium food concession'],
  [/levy@|levy restaurant/i,                                      'salidas_comunes',       0.93, 'stadium food concession (Levy)'],
  [/atl airp market/i,                                            'salidas_comunes',       0.92, 'airport market / food'],
  [/ewr airp/i,                                                   'salidas_comunes',       0.90, 'EWR airport food/retail'],
  [/medialunas del abuelo/i,                                      'salidas_comunes',       0.97, 'Argentine bakery/café'],
  [/ruka horqueta/i,                                              'salidas_comunes',       0.93, 'restaurant'],
  [/lucciano.?s?\b/i,                                            'salidas_comunes',       0.95, 'Lucciano\'s ice cream (Argentina)'],
  [/havanna\b/i,                                                  'salidas_comunes',       0.97, 'Havanna café (Argentina)'],
  [/ls tiki joes/i,                                               'salidas_comunes',       0.95, 'Tiki Joe\'s restaurant'],
  [/met opera bar/i,                                              'salidas_comunes',       0.90, 'Met Opera bar/café'],
  [/dope asian/i,                                                 'salidas_comunes',       0.90, 'restaurant'],
  [/kleos\b/i,                                                    'salidas_comunes',       0.88, 'restaurant (Kleos)'],
  [/jackys waterplace/i,                                          'salidas_comunes',       0.90, 'restaurant'],
  [/andrews bistro/i,                                             'salidas_comunes',       0.92, 'restaurant'],
  [/trattoria romana/i,                                           'salidas_comunes',       0.95, 'Italian restaurant'],
  [/ceviches by divino/i,                                         'salidas_comunes',       0.95, 'ceviche restaurant'],
  [/public kitchen/i,                                             'salidas_comunes',       0.90, 'restaurant'],
  [/deevid ai yau/i,                                              'salidas_comunes',       0.85, 'restaurant (Hong Kong area)'],
  [/mavisx\d{4}/i,                                               'salidas_comunes',       0.75, 'local restaurant / food'],
  [/compan.*golosina/i,                                          'salidas_comunes',       0.85, 'Argentine sweets/candy shop'],
  [/sq \*island beach/i,                                         'salidas_comunes',       0.80, 'beach food/retail'],
  [/new york deli jfk/i,                                          'salidas_comunes',       0.97, 'JFK airport deli'],
  [/fast food blvd/i,                                             'salidas_comunes',       0.90, 'Universal Studios food court'],

  // ── Supermarket / Pharmacy ───────────────────────────────────────────────────
  [/publix\s*#?\d*/i,                                             'super_farmacia_comunes',0.99, 'Publix supermarket'],
  [/shaws?\s+\d{3,}/i,                                           'super_farmacia_comunes',0.99, 'Shaw\'s supermarket'],
  [/central market/i,                                             'super_farmacia_comunes',0.92, 'Central Market grocery'],
  [/duane reade/i,                                                'super_farmacia_comunes',0.99, 'Duane Reade pharmacy'],
  [/harbor point organic/i,                                       'super_farmacia_comunes',0.90, 'organic grocery / farm market'],
  [/sq \*hurds family farm/i,                                     'super_farmacia_comunes',0.90, 'farmers market'],
  [/cvsextracare|cvs.*extra/i,                                   'super_farmacia_comunes',0.99, 'CVS pharmacy'],
  [/nueva fcia|nueva farmacia/i,                                  'super_farmacia_comunes',0.90, 'pharmacy (Argentina)'],
  [/puppis\b/i,                                                   'shopping_comunes',      0.85, 'Puppis pet store (Argentina)'],

  // ── Kids Activities ──────────────────────────────────────────────────────────
  [/greenwich soccer/i,                                           'kids_activities',       0.95, 'Greenwich Soccer Association'],
  [/greenwich dance|ssp\*greenwich dance/i,                      'kids_activities',       0.95, 'Greenwich Dance Studio'],
  [/boys.*girls club/i,                                           'kids_activities',       0.90, 'Boys & Girls Club membership/program'],
  [/tod.?s point sailing/i,                                       'kids_activities',       0.88, 'sailing program'],
  [/cos cob pta|pta\b/i,                                          'kids_colegio',          0.88, 'school PTA'],
  [/tickets.*cob school|tickets.*school/i,                        'kids_colegio',          0.88, 'school event tickets'],
  [/old greenwich tennis/i,                                       'kids_activities',       0.85, 'tennis academy'],
  [/sb5 sports/i,                                                 'kids_activities',       0.80, 'sports program'],

  // ── Adult Activities / Fitness ───────────────────────────────────────────────
  [/ymca\b|ymca of/i,                                             'adult_activities',      0.99, 'YMCA membership'],
  [/homecourt\.c/i,                                               'adult_activities',      0.88, 'Homecourt sports training app'],
  [/greenwich polo/i,                                             'adult_activities',      0.85, 'polo club'],
  [/northwell.*jones beach/i,                                     'salud_comunes',         0.85, 'Northwell Health at Jones Beach'],

  // ── Events / Entertainment ────────────────────────────────────────────────────
  [/fandango/i,                                                   'salidas_eventos',       0.99, 'Fandango movie tickets'],
  [/cinemas ecomm/i,                                              'salidas_eventos',       0.95, 'cinema tickets'],
  [/seatgeek/i,                                                   'salidas_eventos',       0.99, 'SeatGeek event tickets'],
  [/axs\.com|axs\.comlive/i,                                     'salidas_eventos',       0.99, 'AXS live event tickets'],
  [/stubhub inc/i,                                                'salidas_eventos',       0.95, 'StubHub ticket purchase'],
  [/wdw (tickets|lightning lane|lightning.*genie|sir mickey|christmas shop|world of disney|tatooinetraders|toy story)/i, 'salidas_eventos', 0.95, 'Disney park tickets/experience'],
  [/wdw lightning/i,                                              'salidas_eventos',       0.95, 'Disney Lightning Lane'],
  [/universal (orlando|florida)|universal.*resort/i,             'salidas_eventos',       0.95, 'Universal Studios'],
  [/okemo/i,                                                      'salidas_eventos',       0.93, 'Okemo ski resort'],
  [/tickets at work/i,                                            'salidas_eventos',       0.90, 'employee event tickets'],
  [/ludus\.com/i,                                                 'salidas_eventos',       0.88, 'live events'],
  [/sky zone/i,                                                   'salidas_eventos',       0.97, 'Sky Zone trampoline park'],
  [/rpm raceway|stamford rpm/i,                                   'salidas_eventos',       0.95, 'RPM Raceway go-kart'],
  [/ronda.*bowling|paloko bowling/i,                             'salidas_eventos',       0.90, 'bowling entertainment'],
  [/sacoa\b/i,                                                    'salidas_eventos',       0.88, 'Sacoa arcade (Argentina)'],
  [/newport mansions/i,                                           'salidas_eventos',       0.93, 'Newport Mansions tour'],
  [/ollivanders/i,                                                'salidas_eventos',       0.88, 'Harry Potter World experience'],
  [/wdw akershus/i,                                               'salidas_comunes',       0.90, 'Disney Akershus restaurant'],
  [/putting green/i,                                              'adult_activities',      0.85, 'golf putting green'],
  [/atl photo action/i,                                           'salidas_eventos',       0.85, 'photo/entertainment'],

  // ── Shopping ─────────────────────────────────────────────────────────────────
  [/sp maaji|^maaji\b/i,                                          'shopping_comunes',      0.98, 'Maaji swimwear'],
  [/doterra/i,                                                    'shopping_comunes',      0.92, 'doTERRA essential oils'],
  [/samsung\b/i,                                                  'shopping_comunes',      0.95, 'Samsung electronics'],
  [/character warehouse/i,                                        'shopping_comunes',      0.90, 'Disney Character Warehouse outlet'],
  [/longchamp/i,                                                  'shopping_comunes',      0.97, 'Longchamp bags'],
  [/lululemon/i,                                                  'shopping_comunes',      0.99, 'Lululemon athletic wear'],
  [/j\.?crew factory|j crew/i,                                   'shopping_comunes',      0.98, 'J.Crew Factory'],
  [/farm rio\b/i,                                                 'shopping_comunes',      0.97, 'Farm Rio clothing'],
  [/sp owala|owala\b/i,                                           'shopping_comunes',      0.92, 'Owala water bottles'],
  [/etsy\.com/i,                                                  'shopping_comunes',      0.97, 'Etsy marketplace'],
  [/jujumini/i,                                                   'shopping_comunes',      0.85, 'retail purchase'],
  [/maelysc|maelys cosm/i,                                       'shopping_comunes',      0.93, 'Maelys Cosmetics'],
  [/sp omnilux|omnilux/i,                                         'shopping_comunes',      0.90, 'Omnilux LED beauty device'],
  [/wear pact/i,                                                   'shopping_comunes',      0.90, 'Wear Pact sustainable clothing'],
  [/sp stanley|stanley.*pmi/i,                                   'shopping_comunes',      0.90, 'Stanley drinkware'],
  [/wdw (sir mickey|christmas shop|world of disney|tatooinetraders|toy story|combo cart)/i, 'shopping_comunes', 0.90, 'Disney park retail'],
  [/viking traders|breakers gift|marble house gift/i,            'shopping_comunes',      0.88, 'gift shop'],
  [/shutterfly/i,                                                  'shopping_comunes',      0.95, 'Shutterfly photo products'],
  [/barnes.*noble/i,                                              'shopping_comunes',      0.99, 'Barnes & Noble bookstore'],
  [/foot locker/i,                                                 'shopping_comunes',      0.99, 'Foot Locker footwear'],
  [/famous footwear/i,                                            'shopping_comunes',      0.99, 'Famous Footwear'],
  [/sp stevemadden|steve madden/i,                               'shopping_comunes',      0.97, 'Steve Madden footwear'],
  [/beccaritas sport/i,                                           'shopping_comunes',      0.85, 'sports gear (Argentina)'],
  [/boutique del libro/i,                                         'shopping_comunes',      0.90, 'bookstore (Argentina)'],
  [/wayfair/i,                                                     'shopping_comunes',      0.97, 'Wayfair furniture/home'],
  [/lego\b/i,                                                      'shopping_comunes',      0.97, 'LEGO store'],
  [/partycity|party city/i,                                      'shopping_comunes',      0.95, 'Party City'],
  [/strollerfy/i,                                                  'shopping_comunes',      0.88, 'stroller rental/retail'],
  [/inpopnito/i,                                                   'shopping_comunes',      0.80, 'retail purchase'],
  [/sp realty plans|sq \*realty/i,                               'shopping_comunes',      0.70, 'purchase (realty-related)'],
  [/american dream/i,                                              'shopping_comunes',      0.88, 'American Dream mall'],
  [/wf\*.*wayfair/i,                                             'shopping_comunes',      0.97, 'Wayfair'],
  [/maelyscosmetics/i,                                            'shopping_comunes',      0.93, 'Maelys Cosmetics online'],
  [/sp omnilux/i,                                                  'shopping_comunes',      0.90, 'Omnilux beauty device'],

  // ── Health / Medical ─────────────────────────────────────────────────────────
  [/stamford orthodontics/i,                                      'salud_comunes',         0.98, 'orthodontics / dental'],
  [/fairfield county allergy/i,                                   'salud_comunes',         0.98, 'allergy / medical clinic'],
  [/physicians for wom/i,                                         'salud_comunes',         0.97, 'women\'s health clinic'],
  [/northwell/i,                                                   'salud_comunes',         0.97, 'Northwell Health'],
  [/nyu grossman|nyu.*som/i,                                     'salud_comunes',         0.97, 'NYU medical / hospital'],
  [/natural elements.*natur/i,                                    'salud_comunes',         0.82, 'natural health products'],
  [/led estheti/i,                                                 'salud_comunes',         0.88, 'aesthetic / beauty treatment'],
  [/town nail|tip top nails/i,                                    'salud_comunes',         0.90, 'nail salon'],
  [/ls gut reaction/i,                                            'salud_comunes',         0.85, 'health / wellness shop'],
  [/pp\*cupid up/i,                                               'salud_comunes',         0.80, 'Cupid\'s Cup juice bar'],
  [/duane reade/i,                                                 'super_farmacia_comunes',0.99, 'Duane Reade pharmacy/drug store'],

  // ── Home / Improvement ───────────────────────────────────────────────────────
  [/ring.?s end/i,                                                'casa_comunes_anual',    0.97, 'Ring\'s End lumber & building supply'],
  [/byram mason/i,                                                 'casa_comunes_anual',    0.95, 'Byram Mason masonry / building supply'],
  [/lowes?\s*#|lowe.?s\b/i,                                      'casa_comunes_anual',    0.99, 'Lowe\'s home improvement'],
  [/ridgeway garden/i,                                            'casa_comunes_anual',    0.93, 'Ridgeway Garden Center'],
  [/reencle/i,                                                     'casa_comunes_anual',    0.88, 'Reencle home composter'],
  [/ctlp\*csc serviceworks/i,                                    'casa_comunes_mensual',  0.90, 'CSC laundry / building services'],
  [/harbor point organic/i,                                       'super_farmacia_comunes',0.88, 'Harbor Point organic market'],

  // ── Subscriptions ────────────────────────────────────────────────────────────
  [/peacock\b/i,                                                   'suscripciones_comunes', 0.99, 'Peacock streaming'],
  [/uber.*one membership|uber \*one/i,                            'suscripciones_comunes', 0.95, 'Uber One membership'],
  [/google \*(supercell|minecraft|niagara|frame)/i,              'suscripciones_comunes', 0.93, 'Google app/game subscription'],
  [/facebk\b/i,                                                    'suscripciones_comunes', 0.88, 'Facebook advertising spend'],
  [/ring multi plan|ring\.com/i,                                  'suscripciones_comunes', 0.92, 'Ring security subscription'],
  [/whoop\b|offer.*whoop/i,                                      'suscripciones_comunes', 0.92, 'WHOOP fitness tracker subscription'],
  [/homecourt\b/i,                                                 'suscripciones_comunes', 0.85, 'Homecourt sports training app'],

  // ── Business ─────────────────────────────────────────────────────────────────
  [/upwork\s*\*/i,                                                 'business_accenture',    0.90, 'Upwork freelance platform'],
  [/ct secretary of state/i,                                      'business_accenture',    0.92, 'CT state business registration'],
  [/franchise tax bo/i,                                           'business_accenture',    0.92, 'CA Franchise Tax Board'],
  [/monthly fee business adv/i,                                   'business_accenture',    0.90, 'business checking account fee'],
  [/new rochelle passport/i,                                      'business_accenture',    0.75, 'passport / government fee'],

  // ── Donations ────────────────────────────────────────────────────────────────
  [/autism speaks/i,                                               'donation',              0.99, 'Autism Speaks charity'],
  [/paypal.*fairfieldco|pp.*fairfieldco/i,                       'donation',              0.85, 'PayPal charitable donation'],

  // ── Taxes / Fees ─────────────────────────────────────────────────────────────
  [/town of greenwich tax/i,                                      'utilities_comunes',     0.88, 'Greenwich property tax'],

  // ── Misc / Argentina (catch-all patterns) ────────────────────────────────────
  [/santa claus\b/i,                                              'salidas_comunes',       0.75, 'restaurant or retail (Argentina)'],
  [/ronda.*paloko/i,                                              'salidas_eventos',       0.85, 'Ronda Paloko bowling/entertainment'],
  [/compannia de golosina/i,                                      'salidas_comunes',       0.85, 'sweets shop (Argentina)'],
  [/nueva fcia|fcia antonello/i,                                  'super_farmacia_comunes',0.88, 'pharmacy (Argentina)'],

  // ── Restaurants / Cafés ──────────────────────────────────────────────────────
  [/joffrey.?s/i,                                                 'salidas_comunes',       0.92, 'Joffrey\'s Coffee (Disney)'],
  [/taj (stamf|indian|bistro)/i,                                  'salidas_comunes',       0.95, 'Taj Indian restaurant'],
  [/raphael.?s (darien|greenwich)/i,                              'salidas_comunes',       0.93, 'Raphael\'s restaurant'],

  // ── Events ───────────────────────────────────────────────────────────────────
  [/tkts|theater tix/i,                                           'salidas_eventos',       0.95, 'TKTS Broadway / theater tickets'],
  [/neue galerie/i,                                               'salidas_eventos',       0.95, 'Neue Galerie NYC museum'],

  // ── Unknown recurring (low confidence) ───────────────────────────────────────
  [/everyday x\d{4}/i,                                            'suscripciones_comunes', 0.60, 'unknown recurring charge'],
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const [txnsSnap, sugsSnap] = await Promise.all([
    db.ref(`transactions/${UID}`).get(),
    db.ref(`suggestions/${UID}`).get(),
  ]);

  const txns     = txnsSnap.val() ?? {};
  const existing = sugsSnap.val() ?? {};

  const targets = Object.entries(txns).filter(([txnId, t]) => {
    if (existing[txnId]) return false;
    if (t.categorySource === 'manual') return false;
    if (t.ignored) return false;
    if (t.category && t.category !== 'uncategorized') return false;
    return true;
  });

  console.log(`\n${targets.length} targets without suggestions.\n`);

  const patch   = {};
  const matched = [];
  const missed  = [];

  for (const [txnId, txn] of targets) {
    const text = `${txn.merchantName ?? ''} ${txn.description ?? ''}`.trim();
    let hit = null;
    for (const [pattern, catId, conf, hint] of RULES) {
      if (pattern.test(text)) { hit = { catId, conf, hint }; break; }
    }
    const label  = text.slice(0, 50);
    const amount = `$${Math.abs(txn.amount ?? 0).toFixed(2)}`;
    const date   = txn.date ?? '';

    if (hit) {
      patch[`suggestions/${UID}/${txnId}`] = { catId: hit.catId, source: 'heuristic', alts: [], conf: hit.conf, hint: hit.hint };
      matched.push({ label, date, amount, catId: hit.catId, conf: hit.conf, hint: hit.hint });
    } else {
      missed.push({ label, date, amount, bankCat: txn.plaidCategory ?? '' });
    }
  }

  if (Object.keys(patch).length) {
    await db.ref().update(patch);
    console.log(`✓ Written ${Object.keys(patch).length} suggestions to Firebase.\n`);
  }

  const hr = '─'.repeat(72);

  console.log(`CATEGORIZED (${matched.length})`);
  console.log(hr);
  for (const r of matched) {
    console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}`);
    console.log(`             → ${r.catId} (${Math.round(r.conf * 100)}%)  ${r.hint}`);
  }

  if (missed.length) {
    console.log(`\nSTILL UNCATEGORIZED (${missed.length})`);
    console.log(hr);
    for (const r of missed) {
      console.log(`  ${r.date}  ${r.amount.padStart(10)}  ${r.label}${r.bankCat ? `  [${r.bankCat}]` : ''}`);
    }
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  Categorized   : ${matched.length}`);
  console.log(`  Still missing : ${missed.length}`);
  console.log(`${'═'.repeat(72)}\n`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
