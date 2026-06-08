#!/usr/bin/env node
// Generates 50 sample lead inquiry .eml files from various automotive/marine listing services
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'sample-emails');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Data pools ────────────────────────────────────────────────────────────────

const cars = [
  { year: 2022, make: 'Toyota',     model: 'Camry SE',           vin: '4T1B11HK8NU624831', stock: 'TC22-4831', price: '$24,995', color: 'Midnight Black', miles: 18420 },
  { year: 2023, make: 'Ford',       model: 'F-150 XLT',          vin: '1FTFW1E83PKD41092', stock: 'FF23-1092', price: '$42,500', color: 'Oxford White',   miles: 5210  },
  { year: 2021, make: 'Honda',      model: 'Accord Sport',        vin: '1HGCV1F32MA021883', stock: 'HA21-1883', price: '$22,800', color: 'Sonic Gray Pearl',miles: 31005 },
  { year: 2024, make: 'Chevrolet',  model: 'Silverado 1500 LT',  vin: '3GCUYDED0RG204710', stock: 'CS24-4710', price: '$48,200', color: 'Summit White',    miles: 1100  },
  { year: 2022, make: 'BMW',        model: '330i xDrive',         vin: '3MW5R7J05N8C20547', stock: 'BM22-0547', price: '$38,900', color: 'Alpine White',    miles: 22300 },
  { year: 2023, make: 'Tesla',      model: 'Model 3 Long Range',  vin: '5YJ3E1EA0PF412293', stock: 'TM23-2293', price: '$43,990', color: 'Pearl White',     miles: 7830  },
  { year: 2021, make: 'Jeep',       model: 'Grand Cherokee 4xe', vin: '1C4RJYB66MC560021', stock: 'JG21-0021', price: '$37,500', color: 'Granite Crystal',  miles: 28900 },
  { year: 2022, make: 'Hyundai',    model: 'Tucson SEL',          vin: '5NMJB3AE4NH048220', stock: 'HT22-8220', price: '$28,400', color: 'Phantom Black',   miles: 19750 },
  { year: 2023, make: 'Kia',        model: 'Telluride SX',        vin: '5XYP5DHC3PG237619', stock: 'KT23-7619', price: '$45,100', color: 'Snow White Pearl', miles: 4400  },
  { year: 2021, make: 'Nissan',     model: 'Altima SR',           vin: '1N4BL4CV8MN376001', stock: 'NA21-6001', price: '$19,900', color: 'Scarlet Ember',   miles: 34200 },
  { year: 2022, make: 'Subaru',     model: 'Outback Wilderness',  vin: '4S4BTGUD4N3267813', stock: 'SO22-7813', price: '$32,600', color: 'Geyser Blue',      miles: 15800 },
  { year: 2023, make: 'Mazda',      model: 'CX-5 Carbon Edition', vin: 'JM3KFBCM4P0172549', stock: 'MC23-2549', price: '$34,250', color: 'Soul Red Crystal', miles: 8900  },
  { year: 2021, make: 'GMC',        model: 'Sierra 1500 SLT',     vin: '1GTU9DED6MZ204017', stock: 'GS21-4017', price: '$41,800', color: 'Onyx Black',      miles: 29500 },
  { year: 2022, make: 'Lexus',      model: 'RX 350 F Sport',      vin: '2T2HZMDA4NC238800', stock: 'LR22-8800', price: '$52,900', color: 'Eminent White',   miles: 16300 },
  { year: 2023, make: 'Audi',       model: 'A4 45 TFSI quattro',  vin: 'WAUENAF41PN039104', stock: 'AU23-9104', price: '$46,700', color: 'Florett Silver',   miles: 6100  },
  { year: 2021, make: 'Mercedes-Benz', model: 'C 300 4MATIC',     vin: 'W1KWF8EB0MR565432', stock: 'MB21-5432', price: '$39,400', color: 'Polar White',     miles: 27100 },
  { year: 2022, make: 'Volkswagen', model: 'Jetta GLI',           vin: '3VW5T7BU8NM044986', stock: 'VW22-4986', price: '$26,900', color: 'Deep Black Pearl', miles: 21000 },
  { year: 2023, make: 'Ram',        model: '1500 Big Horn',       vin: '1C6SRFBT4PN634751', stock: 'RM23-4751', price: '$44,600', color: 'Flame Red',        miles: 3300  },
  { year: 2021, make: 'Dodge',      model: 'Charger Scat Pack',   vin: '2C3CDXGJ3MH513827', stock: 'DC21-3827', price: '$44,900', color: 'TorRed',          miles: 22600 },
  { year: 2022, make: 'Chrysler',   model: 'Pacifica Touring L',  vin: '2C4RC1BG6NR513044', stock: 'CP22-3044', price: '$36,200', color: 'Brilliant Black',  miles: 18100 },
  { year: 2023, make: 'Chevrolet',  model: 'Corvette Stingray',   vin: '1G1YB2D44P5108823', stock: 'CV23-8823', price: '$68,500', color: 'Amplify Orange',   miles: 2200  },
  { year: 2022, make: 'Ford',       model: 'Mustang GT Premium',  vin: '1FA6P8CF9N5104921', stock: 'FM22-4921', price: '$38,800', color: 'Code Orange',      miles: 14700 },
  { year: 2024, make: 'Hyundai',    model: 'Ioniq 6 SE',          vin: 'KMHM34AC2RA007832', stock: 'HI24-7832', price: '$38,450', color: 'Gravity Gold',     miles: 900   },
  { year: 2021, make: 'Toyota',     model: 'RAV4 Prime XSE',      vin: '4T3RWRFV5MU023541', stock: 'TR21-3541', price: '$34,900', color: 'Blueprint',        miles: 26400 },
  { year: 2022, make: 'Honda',      model: 'CR-V Touring AWD',    vin: '7FARW2H89NE039012', stock: 'HC22-9012', price: '$32,100', color: 'Sonic Gray Pearl', miles: 17900 },
];

const boats = [
  { year: 2021, make: 'Sea Ray',       model: '230 SLX',           vin: 'SERAY204K021',  stock: 'SR21-4204', price: '$54,900', length: '23 ft', type: 'Bowrider'     },
  { year: 2022, make: 'Boston Whaler', model: '270 Dauntless',     vin: 'BWCE2761B222',  stock: 'BW22-2761', price: '$121,500', length: '27 ft', type: 'Center Console'},
  { year: 2023, make: 'Cobalt',        model: 'R5 WSS',            vin: 'FGE10558B323',  stock: 'CB23-0558', price: '$89,900', length: '22 ft', type: 'Sport'        },
  { year: 2021, make: 'Chaparral',     model: '21 H2O Sport',      vin: 'CHR21201D121',  stock: 'CH21-1201', price: '$44,800', length: '21 ft', type: 'Bowrider'     },
  { year: 2022, make: 'Malibu',        model: 'Wakesetter 21 LX',  vin: 'MB C2120D222',  stock: 'MB22-2120', price: '$112,000', length: '21 ft', type: 'Ski/Wakeboard'},
  { year: 2023, make: 'Grady-White',   model: 'Canyon 306',        vin: 'GWF3061C323',   stock: 'GW23-3061', price: '$175,000', length: '30 ft', type: 'Center Console'},
  { year: 2021, make: 'Lund',          model: '1875 Impact XS',    vin: 'LUN18753C121',  stock: 'LU21-1875', price: '$32,400', length: '18 ft', type: 'Fishing'      },
  { year: 2022, make: 'Bayliner',      model: 'Element E18',       vin: 'BAY18E2D222',   stock: 'BA22-1800', price: '$19,900', length: '18 ft', type: 'Bowrider'     },
  { year: 2023, make: 'Chris-Craft',   model: 'Launch 25 GT',      vin: 'CCR2510C323',   stock: 'CC23-2510', price: '$148,000', length: '25 ft', type: 'Runabout'     },
  { year: 2021, make: 'Monterey',      model: '258 SS',            vin: 'MON25831C121',  stock: 'MO21-2583', price: '$67,500', length: '26 ft', type: 'Sport Cruiser' },
  { year: 2022, make: 'Regal',         model: '26 OBX',            vin: 'RGL260D2D222',  stock: 'RG22-2600', price: '$78,900', length: '26 ft', type: 'Bowrider'     },
  { year: 2023, make: 'Formula',       model: '350 CBR',           vin: 'FOR35010C323',  stock: 'FO23-3500', price: '$235,000', length: '35 ft', type: 'Cruiser'      },
];

const leads = [
  { first: 'James',   last: 'Thornton',   email: 'james.thornton@gmail.com',     phone: '(813) 555-0192' },
  { first: 'Maria',   last: 'Delgado',    email: 'mdelgado88@hotmail.com',       phone: '(702) 555-0348' },
  { first: 'Kevin',   last: 'Patterson',  email: 'kpatterson@outlook.com',       phone: null              },
  { first: 'Ashley',  last: 'Nguyen',     email: null,                           phone: '(954) 555-0817' },
  { first: 'Robert',  last: 'Kimura',     email: 'rob.kimura@yahoo.com',         phone: '(503) 555-0264' },
  { first: 'Sandra',  last: 'Brooks',     email: 'sandra.brooks@me.com',         phone: '(615) 555-0531' },
  { first: 'Tyler',   last: 'Henson',     email: 'tyler_henson@gmail.com',       phone: null              },
  { first: 'Priya',   last: 'Anand',      email: 'priya.anand@gmail.com',        phone: '(408) 555-0973' },
  { first: 'Marcus',  last: 'Jefferson',  email: 'mjefferson77@aol.com',         phone: '(312) 555-0445' },
  { first: 'Lauren',  last: 'Weston',     email: null,                           phone: '(480) 555-0620' },
  { first: 'Derek',   last: 'Okafor',     email: 'dokafor@gmail.com',            phone: '(214) 555-0387' },
  { first: 'Cynthia', last: 'Martinez',   email: 'c.martinez@icloud.com',        phone: '(305) 555-0158' },
  { first: 'Nathan',  last: 'Lowe',       email: 'nlowe1984@hotmail.com',        phone: null              },
  { first: 'Jessica', last: 'Fairbanks',  email: 'jfairbanks@yahoo.com',         phone: '(720) 555-0792' },
  { first: 'Brian',   last: 'Castillo',   email: 'brian.castillo@gmail.com',     phone: '(619) 555-0234' },
  { first: 'Megan',   last: 'Sullivan',   email: null,                           phone: '(651) 555-0509' },
  { first: 'Ethan',   last: 'Park',       email: 'epark.auto@gmail.com',         phone: '(213) 555-0863' },
  { first: 'Diana',   last: 'Reeves',     email: 'dreeves@outlook.com',          phone: '(256) 555-0317' },
  { first: 'Carlos',  last: 'Ibáñez',     email: 'carlos.ibanez@gmail.com',      phone: '(915) 555-0746' },
  { first: 'Tiffany', last: 'Monroe',     email: 'tmonroe@yahoo.com',            phone: null              },
  { first: 'Gregory', last: 'Nakamura',   email: 'g.nakamura@gmail.com',         phone: '(808) 555-0129' },
  { first: 'Alicia',  last: 'Stern',      email: 'alicia.stern@hotmail.com',     phone: '(314) 555-0683' },
  { first: 'Patrick', last: 'O\'Brien',   email: 'pobrien@gmail.com',            phone: '(617) 555-0274' },
  { first: 'Vanessa', last: 'Holloway',   email: null,                           phone: '(901) 555-0458' },
  { first: 'Scott',   last: 'Yamamoto',   email: 'scott.yam@icloud.com',         phone: '(425) 555-0915' },
  { first: 'Rachel',  last: 'Griffith',   email: 'rachgriffith@gmail.com',       phone: '(317) 555-0061' },
  { first: 'Anthony', last: 'Ferraro',    email: 'aferraro@yahoo.com',           phone: '(631) 555-0399' },
  { first: 'Heather', last: 'Chandler',   email: 'h.chandler@outlook.com',       phone: null              },
  { first: 'Jerome',  last: 'Washington', email: 'jwashington@gmail.com',        phone: '(404) 555-0742' },
  { first: 'Olivia',  last: 'Beckett',    email: 'olivia.beckett@me.com',        phone: '(843) 555-0186' },
  { first: 'Brandon', last: 'Cho',        email: 'brandoncho@gmail.com',         phone: '(206) 555-0527' },
  { first: 'Natalie', last: 'Dunn',       email: 'ndunn84@hotmail.com',          phone: '(757) 555-0843' },
  { first: 'Edward',  last: 'Lawson',     email: null,                           phone: '(859) 555-0371' },
  { first: 'Amber',   last: 'Russo',      email: 'amber.russo@gmail.com',        phone: '(504) 555-0694' },
  { first: 'Steven',  last: 'McAllister', email: 'smcallister@yahoo.com',        phone: '(602) 555-0238' },
  { first: 'Monica',  last: 'Herrera',    email: 'monica.herrera@gmail.com',     phone: null              },
  { first: 'Curtis',  last: 'Blake',      email: 'curtisblake@outlook.com',      phone: '(901) 555-0512' },
  { first: 'Tricia',  last: 'Owens',      email: 'triciaowens@gmail.com',        phone: '(336) 555-0289' },
  { first: 'Joel',    last: 'Patel',      email: 'joel.patel88@gmail.com',       phone: '(469) 555-0634' },
  { first: 'Kristen', last: 'Vega',       email: null,                           phone: '(702) 555-0977' },
  { first: 'Darnell', last: 'Cooper',     email: 'dcooper@gmail.com',            phone: '(313) 555-0453' },
  { first: 'Elaine',  last: 'Shepherd',   email: 'elaine.shepherd@icloud.com',   phone: '(615) 555-0108' },
  { first: 'Raymond', last: 'Torres',     email: 'rtorres@hotmail.com',          phone: null              },
  { first: 'Felicia', last: 'Grant',      email: 'felicia.grant@gmail.com',      phone: '(832) 555-0756' },
  { first: 'Walter',  last: 'Higgins',    email: 'whiggins@yahoo.com',           phone: '(518) 555-0341' },
  { first: 'Stephanie', last: 'Lawton',   email: 'slawton@gmail.com',            phone: '(561) 555-0892' },
  { first: 'Terrence', last: 'Simmons',   email: 'terrence.simmons@outlook.com', phone: '(248) 555-0167' },
  { first: 'Audrey',  last: 'Kim',        email: 'akim@gmail.com',               phone: null              },
  { first: 'Phillip', last: 'Morales',    email: 'pmorales77@gmail.com',         phone: '(520) 555-0439' },
  { first: 'Cheryl',  last: 'Benson',     email: 'cheryl.benson@me.com',         phone: '(904) 555-0673' },
];

const messages = [
  "I'm very interested in this vehicle and would love to schedule a test drive at your earliest convenience. What times do you have available this week?",
  "Hi, I saw this listed online and it looks like exactly what I've been searching for. Can you tell me if there are any additional fees beyond the listed price? Also, is it still available?",
  "Does this vehicle have a clean title? I'd like to see a full Carfax report before moving forward. Also, is there any room to negotiate on the price?",
  "I've been searching for this exact model for a few months. Is this still available? I can come in for a test drive anytime this weekend.",
  "I'm a cash buyer and can close quickly. What's the out-the-door price including all taxes and fees? I'm also wondering if there are any warranties included.",
  "My current lease is ending next month and I'm looking to purchase something soon. Can you provide the full vehicle history and let me know if it's been in any accidents?",
  "I'm interested in financing options. Do you work with my credit union or only your in-house financing? I'd like to know the monthly payment on this vehicle.",
  "Could you send me more photos? Specifically the interior, trunk, and under the hood. Also, is there any rust or damage not shown in the listing photos?",
  "I just moved to the area and need reliable transportation quickly. Is this still on the lot? I can come today if needed.",
  "Been looking for a family hauler and this fits my needs. How many previous owners? Any major service work done recently? Would you consider a trade-in as part of the deal?",
  "I'm interested in this one — I tried calling earlier but couldn't get through. Please have someone contact me at the number on file. Best time to reach me is after 5 PM.",
  "This looks like a great deal! I noticed it's been listed for a while. Is there any flexibility on the price? I'm a serious buyer and can come in this week.",
  "I'm a first-time buyer and a bit nervous about the process. Can you walk me through what I'd need to bring to the dealership? Also, is the price negotiable?",
  "Do you offer any kind of test-drive at home or mobile test drives? I'm about 2 hours away and want to make sure it's the right fit before making the drive.",
  "I've been pre-approved for financing through my bank. I'm ready to move quickly if the price is right. Please reach out — I'm very interested.",
];

const boatMessages = [
  "I'm very interested in this boat. Does it come with a trailer? Also, what kind of engine hours are on it and has it been stored in fresh or salt water?",
  "This looks like a great vessel for our family. Can you tell me about the service history and whether any major maintenance has been performed recently?",
  "I'm a serious buyer looking to purchase before the summer season. Is there room to negotiate? I'd also like to arrange a sea trial if possible.",
  "Can you provide more details about the electronics package and any upgrades that have been added? Also, is the price firm or is there some flexibility?",
  "I've been looking for this model for some time. What's the engine make and model, and can you tell me about any recent repairs or service done to it?",
  "I'm interested in this boat for lake use. Does it come with a trailer and any extras like fenders, ropes, or a cover? Happy to schedule a showing this weekend.",
];

// ── Source templates ──────────────────────────────────────────────────────────

function cargurusEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'leads@cargurus.com',
    fromName: 'CarGurus Lead',
    to: 'sales@dealership.com',
    subject: `New Lead: ${car.year} ${car.make} ${car.model} — ${lead.first} ${lead.last}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;color:#222;font-size:14px;margin:0;padding:0;background:#f4f4f4}
.wrapper{max-width:640px;margin:20px auto;background:#fff;border:1px solid #ddd;border-radius:4px}
.header{background:#00A0DC;padding:16px 24px;border-radius:4px 4px 0 0}
.header img{height:28px}
.header-title{color:#fff;font-size:18px;font-weight:bold;margin-top:8px}
.body{padding:24px}
.section-title{font-size:12px;font-weight:bold;color:#666;text-transform:uppercase;letter-spacing:.5px;margin:20px 0 8px}
.field-row{display:flex;margin-bottom:6px}
.field-label{width:160px;color:#666;font-size:13px;flex-shrink:0}
.field-value{color:#222;font-size:13px;font-weight:600}
.vehicle-box{background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;padding:14px 18px;margin-bottom:16px}
.vehicle-title{font-size:16px;font-weight:bold;color:#00A0DC}
.message-box{background:#fffbe6;border-left:4px solid #FFB800;padding:12px 16px;margin:16px 0;font-style:italic;color:#444}
.footer{background:#f0f0f0;padding:12px 24px;font-size:11px;color:#888;border-radius:0 0 4px 4px}
</style></head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="header-title">CarGurus — New Lead Notification</div>
  </div>
  <div class="body">
    <div class="section-title">Vehicle of Interest</div>
    <div class="vehicle-box">
      <div class="vehicle-title">${car.year} ${car.make} ${car.model}</div>
      <div class="field-row"><span class="field-label">VIN:</span><span class="field-value">${car.vin}</span></div>
      <div class="field-row"><span class="field-label">Stock #:</span><span class="field-value">${car.stock}</span></div>
      <div class="field-row"><span class="field-label">Price:</span><span class="field-value">${car.price}</span></div>
      <div class="field-row"><span class="field-label">Color:</span><span class="field-value">${car.color}</span></div>
      <div class="field-row"><span class="field-label">Mileage:</span><span class="field-value">${car.miles.toLocaleString()} mi</span></div>
    </div>
    <div class="section-title">Lead Information</div>
    <div class="field-row"><span class="field-label">Name:</span><span class="field-value">${lead.first} ${lead.last}</span></div>
    ${hasEmail ? `<div class="field-row"><span class="field-label">Email:</span><span class="field-value">${lead.email}</span></div>` : ''}
    ${hasPhone ? `<div class="field-row"><span class="field-label">Phone:</span><span class="field-value">${lead.phone}</span></div>` : ''}
    <div class="field-row"><span class="field-label">Lead Type:</span><span class="field-value">Price Quote Request</span></div>
    <div class="field-row"><span class="field-label">Source:</span><span class="field-value">CarGurus.com</span></div>
    <div class="section-title">Customer Message</div>
    <div class="message-box">"${msg}"</div>
  </div>
  <div class="footer">This lead was generated via CarGurus.com. Lead ID: CG-${seqNum.toString().padStart(7,'0')}. ${dateStr}</div>
</div>
</body></html>`
  };
}

function carsDotComEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'leads@cars.com',
    fromName: 'Cars.com Leads',
    to: 'sales@dealership.com',
    subject: `Cars.com Inquiry: ${car.year} ${car.make} ${car.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f5f5f5;margin:0;padding:0}
.container{max-width:600px;margin:16px auto;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.top-bar{background:#E11B22;height:6px}
.header{padding:20px 28px 12px;border-bottom:1px solid #eee}
.logo-text{font-size:22px;font-weight:900;color:#E11B22;letter-spacing:-1px}
.logo-text span{color:#222}
.tag{display:inline-block;background:#E11B22;color:#fff;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:3px;margin-left:8px;vertical-align:middle}
.content{padding:20px 28px}
h3{margin:0 0 12px;font-size:15px;color:#333}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
td{padding:7px 10px;font-size:13px;border-bottom:1px solid #f0f0f0}
td:first-child{color:#777;width:140px}
td:last-child{font-weight:600;color:#222}
.highlight-row td{background:#fef9ec}
.msg{background:#f7f7f7;border-radius:4px;padding:14px;font-size:13px;color:#444;line-height:1.6;margin-top:8px}
.footer{background:#f9f9f9;padding:12px 28px;font-size:11px;color:#999;border-top:1px solid #eee}
</style></head>
<body>
<div class="container">
  <div class="top-bar"></div>
  <div class="header">
    <div class="logo-text">cars<span>.com</span><span class="tag">NEW LEAD</span></div>
  </div>
  <div class="content">
    <h3>Vehicle Inquiry Details</h3>
    <table>
      <tr><td>Vehicle</td><td>${car.year} ${car.make} ${car.model}</td></tr>
      <tr class="highlight-row"><td>VIN</td><td>${car.vin}</td></tr>
      <tr><td>Stock #</td><td>${car.stock}</td></tr>
      <tr><td>Listed Price</td><td>${car.price}</td></tr>
      <tr><td>Mileage</td><td>${car.miles.toLocaleString()} miles</td></tr>
      <tr><td>Exterior Color</td><td>${car.color}</td></tr>
    </table>
    <h3>Buyer Information</h3>
    <table>
      <tr><td>Full Name</td><td>${lead.first} ${lead.last}</td></tr>
      ${hasEmail ? `<tr><td>Email</td><td>${lead.email}</td></tr>` : ''}
      ${hasPhone ? `<tr><td>Phone</td><td>${lead.phone}</td></tr>` : ''}
      <tr><td>Contact Pref.</td><td>${hasEmail && hasPhone ? 'Email or Phone' : hasEmail ? 'Email' : 'Phone'}</td></tr>
    </table>
    <h3>Message from Buyer</h3>
    <div class="msg">${msg}</div>
  </div>
  <div class="footer">Ref: CRS-${seqNum.toString().padStart(8,'0')} &bull; ${dateStr} &bull; Cars.com, 175 W. Jackson Blvd., Chicago, IL 60604</div>
</div>
</body></html>`
  };
}

function autotraderEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'noreply@autotrader.com',
    fromName: 'AutoTrader Lead Notification',
    to: 'internet@dealership.com',
    subject: `[AutoTrader] Lead Alert — ${lead.first} ${lead.last} is interested in your ${car.year} ${car.make} ${car.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#EDEEEF;font-family:Arial,sans-serif}
.wrap{max-width:620px;margin:20px auto}
.hdr{background:#E8590C;padding:18px 24px;border-radius:4px 4px 0 0;display:flex;align-items:center}
.hdr-title{color:#fff;font-size:20px;font-weight:bold;font-style:italic}
.badge{background:#fff;color:#E8590C;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:12px;margin-left:12px}
.card{background:#fff;border:1px solid #ddd;border-top:none}
.section{padding:20px 24px;border-bottom:1px solid #eee}
.section-label{font-size:11px;font-weight:bold;text-transform:uppercase;color:#E8590C;margin-bottom:10px;letter-spacing:.5px}
.row{display:flex;margin-bottom:8px;align-items:baseline}
.lbl{min-width:150px;font-size:12px;color:#888}
.val{font-size:13px;font-weight:700;color:#111}
.vin-highlight{font-family:monospace;background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:12px}
.msg-section{padding:20px 24px}
.msg-label{font-size:11px;font-weight:bold;text-transform:uppercase;color:#E8590C;margin-bottom:8px;letter-spacing:.5px}
.msg-body{background:#fff8f5;border:1px solid #ffd0b5;border-radius:4px;padding:14px;font-size:13px;color:#333;line-height:1.65}
.footer-bar{background:#333;padding:10px 24px;border-radius:0 0 4px 4px;font-size:11px;color:#aaa}
</style></head>
<body>
<div class="wrap">
  <div class="hdr">
    <span class="hdr-title">AutoTrader</span>
    <span class="badge">NEW LEAD</span>
  </div>
  <div class="card">
    <div class="section">
      <div class="section-label">Vehicle Details</div>
      <div class="row"><span class="lbl">Year / Make / Model</span><span class="val">${car.year} ${car.make} ${car.model}</span></div>
      <div class="row"><span class="lbl">VIN</span><span class="val"><span class="vin-highlight">${car.vin}</span></span></div>
      <div class="row"><span class="lbl">Stock Number</span><span class="val">${car.stock}</span></div>
      <div class="row"><span class="lbl">Asking Price</span><span class="val">${car.price}</span></div>
      <div class="row"><span class="lbl">Miles</span><span class="val">${car.miles.toLocaleString()}</span></div>
      <div class="row"><span class="lbl">Color</span><span class="val">${car.color}</span></div>
    </div>
    <div class="section">
      <div class="section-label">Lead Contact</div>
      <div class="row"><span class="lbl">Name</span><span class="val">${lead.first} ${lead.last}</span></div>
      ${hasEmail ? `<div class="row"><span class="lbl">Email Address</span><span class="val">${lead.email}</span></div>` : ''}
      ${hasPhone ? `<div class="row"><span class="lbl">Phone Number</span><span class="val">${lead.phone}</span></div>` : ''}
      <div class="row"><span class="lbl">Lead ID</span><span class="val">AT-${seqNum.toString().padStart(9,'0')}</span></div>
      <div class="row"><span class="lbl">Received</span><span class="val">${dateStr}</span></div>
    </div>
    <div class="msg-section">
      <div class="msg-label">Customer's Message</div>
      <div class="msg-body">"${msg}"</div>
    </div>
  </div>
  <div class="footer-bar">AutoTrader &copy; 2026 | Cox Automotive | Atlanta, GA | Lead Reference: AT-${seqNum.toString().padStart(9,'0')}</div>
</div>
</body></html>`
  };
}

function boattraderEmail(lead, boat, msgIndex, dateStr, seqNum) {
  const msg = boatMessages[msgIndex % boatMessages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'leads@boattrader.com',
    fromName: 'Boat Trader Lead',
    to: 'sales@marinedealership.com',
    subject: `Boat Trader Inquiry — ${boat.year} ${boat.make} ${boat.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#003F6B;font-family:'Arial',sans-serif}
.outer{max-width:600px;margin:20px auto;background:#fff;border-radius:6px;overflow:hidden}
.hdr{background:#003F6B;padding:20px 24px}
.hdr-title{color:#FFF;font-size:22px;font-weight:bold}
.hdr-sub{color:#7EC8E3;font-size:13px;margin-top:4px}
.body{padding:24px}
.vehicle-card{background:#E8F4FD;border-radius:6px;padding:16px 20px;margin-bottom:18px;border-left:4px solid #0073B1}
.vehicle-name{font-size:17px;font-weight:bold;color:#003F6B;margin-bottom:10px}
dl{margin:0;display:grid;grid-template-columns:140px 1fr;gap:4px 12px}
dt{color:#555;font-size:12px;font-weight:bold;text-transform:uppercase}
dd{margin:0;font-size:13px;font-weight:600;color:#111}
.contact-table{width:100%;border-collapse:collapse;margin-top:12px}
.contact-table td{padding:8px 0;font-size:13px;border-bottom:1px solid #eee}
.contact-table td:first-child{color:#777;width:130px}
.contact-table td:last-child{font-weight:600}
.msg-box{background:#f7fbff;border:1px solid #c5dff0;border-radius:4px;padding:14px;margin-top:16px;font-size:13px;color:#333;line-height:1.65}
.footer{background:#003F6B;padding:12px 24px;font-size:11px;color:#7EC8E3}
</style></head>
<body>
<div class="outer">
  <div class="hdr">
    <div class="hdr-title">Boat Trader</div>
    <div class="hdr-sub">New Lead Notification &mdash; ${dateStr}</div>
  </div>
  <div class="body">
    <p style="font-size:14px;color:#333">A potential buyer has submitted an inquiry through <strong>BoatTrader.com</strong> about the following listing:</p>
    <div class="vehicle-card">
      <div class="vehicle-name">${boat.year} ${boat.make} ${boat.model}</div>
      <dl>
        <dt>HIN / VIN</dt><dd>${boat.vin}</dd>
        <dt>Stock #</dt><dd>${boat.stock}</dd>
        <dt>Price</dt><dd>${boat.price}</dd>
        <dt>Length</dt><dd>${boat.length}</dd>
        <dt>Type</dt><dd>${boat.type}</dd>
      </dl>
    </div>
    <h3 style="font-size:13px;text-transform:uppercase;color:#003F6B;letter-spacing:.5px">Buyer Contact Information</h3>
    <table class="contact-table">
      <tr><td>Name</td><td>${lead.first} ${lead.last}</td></tr>
      ${hasEmail ? `<tr><td>Email</td><td>${lead.email}</td></tr>` : ''}
      ${hasPhone ? `<tr><td>Phone</td><td>${lead.phone}</td></tr>` : ''}
      <tr><td>Lead Source</td><td>BoatTrader.com</td></tr>
      <tr><td>Reference #</td><td>BT-${seqNum.toString().padStart(7,'0')}</td></tr>
    </table>
    <h3 style="font-size:13px;text-transform:uppercase;color:#003F6B;letter-spacing:.5px;margin-top:20px">Buyer Message</h3>
    <div class="msg-box">${msg}</div>
  </div>
  <div class="footer">BoatTrader.com &bull; Dominion Marine Media &bull; Norfolk, VA &bull; Lead ID: BT-${seqNum.toString().padStart(7,'0')}</div>
</div>
</body></html>`
  };
}

function boatsDotComEmail(lead, boat, msgIndex, dateStr, seqNum) {
  const msg = boatMessages[msgIndex % boatMessages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'noreply@boats.com',
    fromName: 'Boats.com',
    to: 'sales@marinedealership.com',
    subject: `boats.com — New Inquiry: ${boat.year} ${boat.make} ${boat.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:20px;background:#f0f4f7;font-family:Georgia,'Times New Roman',serif}
.card{max-width:580px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.topbar{background:#1A6B9A;padding:14px 22px;display:flex;justify-content:space-between;align-items:center}
.logo{color:#fff;font-size:20px;font-weight:bold;letter-spacing:-1px}
.new-badge{background:#F5A623;color:#fff;font-size:11px;font-weight:bold;padding:4px 10px;border-radius:3px}
.section{padding:20px 22px;border-bottom:1px solid #eee}
.sh{font-size:11px;font-weight:bold;text-transform:uppercase;color:#1A6B9A;margin:0 0 10px;letter-spacing:.4px}
.fl{display:flex;flex-wrap:wrap;gap:12px}
.fi{flex:1;min-width:120px}
.fi-label{font-size:10px;color:#999;text-transform:uppercase;margin-bottom:2px}
.fi-value{font-size:13px;font-weight:bold;color:#222}
.msg{padding:20px 22px;font-size:13px;color:#555;font-style:italic;line-height:1.7;background:#fafafa}
.ft{background:#1A6B9A;padding:10px 22px;font-size:11px;color:#a0c8e0}
</style></head>
<body>
<div class="card">
  <div class="topbar">
    <div class="logo">boats.com</div>
    <div class="new-badge">NEW INQUIRY</div>
  </div>
  <div class="section">
    <p class="sh">Listing</p>
    <div class="fl">
      <div class="fi"><div class="fi-label">Year / Make</div><div class="fi-value">${boat.year} ${boat.make}</div></div>
      <div class="fi"><div class="fi-label">Model</div><div class="fi-value">${boat.model}</div></div>
      <div class="fi"><div class="fi-label">HIN</div><div class="fi-value">${boat.vin}</div></div>
      <div class="fi"><div class="fi-label">Price</div><div class="fi-value">${boat.price}</div></div>
      <div class="fi"><div class="fi-label">Type</div><div class="fi-value">${boat.type}</div></div>
      <div class="fi"><div class="fi-label">Length</div><div class="fi-value">${boat.length}</div></div>
    </div>
  </div>
  <div class="section">
    <p class="sh">Buyer</p>
    <div class="fl">
      <div class="fi"><div class="fi-label">Name</div><div class="fi-value">${lead.first} ${lead.last}</div></div>
      ${hasEmail ? `<div class="fi"><div class="fi-label">Email</div><div class="fi-value">${lead.email}</div></div>` : ''}
      ${hasPhone ? `<div class="fi"><div class="fi-label">Phone</div><div class="fi-value">${lead.phone}</div></div>` : ''}
    </div>
  </div>
  <div class="msg">"${msg}"</div>
  <div class="ft">boats.com &bull; Inquiry #BCM-${seqNum.toString().padStart(8,'0')} &bull; ${dateStr}</div>
</div>
</body></html>`
  };
}

function yachtworldEmail(lead, boat, msgIndex, dateStr, seqNum) {
  const msg = boatMessages[msgIndex % boatMessages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'inquiries@yachtworld.com',
    fromName: 'YachtWorld Inquiry',
    to: 'brokerage@marinedealership.com',
    subject: `YachtWorld Inquiry — ${boat.year} ${boat.make} ${boat.model} (${boat.price})`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#0a1628;font-family:'Trebuchet MS',Arial,sans-serif}
.wrapper{max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden}
.header{background:linear-gradient(135deg,#0a1628 0%,#1a3a6b 100%);padding:24px;text-align:center}
.yw-logo{color:#C9A84C;font-size:24px;font-weight:bold;letter-spacing:3px;text-transform:uppercase}
.yw-sub{color:#8ab0d8;font-size:12px;letter-spacing:1px;margin-top:4px}
.gold-bar{height:3px;background:linear-gradient(90deg,#C9A84C,#E8D48B,#C9A84C)}
.content{padding:28px}
.vessel-title{font-size:18px;font-weight:bold;color:#0a1628;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #C9A84C}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px}
.info-item{background:#f8f6f0;padding:10px 14px;border-radius:4px}
.info-item-label{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.info-item-value{font-size:13px;font-weight:bold;color:#0a1628}
.divider{border:none;border-top:1px solid #eee;margin:20px 0}
.contact-list{list-style:none;padding:0;margin:0}
.contact-list li{padding:8px 0;font-size:13px;border-bottom:1px solid #f5f5f5;display:flex}
.contact-list li span:first-child{width:100px;color:#999;font-size:12px}
.contact-list li span:last-child{font-weight:600;color:#0a1628}
.message{background:#f8f6f0;border-left:3px solid #C9A84C;padding:14px 18px;font-size:13px;color:#444;line-height:1.7;font-style:italic;margin-top:16px}
.footer{background:#0a1628;padding:14px 24px;font-size:11px;color:#5a7fa0;text-align:center}
</style></head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="yw-logo">YachtWorld</div>
    <div class="yw-sub">Premium Marine Marketplace</div>
  </div>
  <div class="gold-bar"></div>
  <div class="content">
    <div class="vessel-title">${boat.year} ${boat.make} ${boat.model}</div>
    <div class="info-grid">
      <div class="info-item"><div class="info-item-label">HIN / VIN</div><div class="info-item-value">${boat.vin}</div></div>
      <div class="info-item"><div class="info-item-label">Asking Price</div><div class="info-item-value">${boat.price}</div></div>
      <div class="info-item"><div class="info-item-label">Length</div><div class="info-item-value">${boat.length}</div></div>
      <div class="info-item"><div class="info-item-label">Category</div><div class="info-item-value">${boat.type}</div></div>
      <div class="info-item"><div class="info-item-label">Stock #</div><div class="info-item-value">${boat.stock}</div></div>
      <div class="info-item"><div class="info-item-label">Reference</div><div class="info-item-value">YW-${seqNum.toString().padStart(7,'0')}</div></div>
    </div>
    <hr class="divider">
    <strong style="font-size:13px;color:#0a1628">Buyer Contact</strong>
    <ul class="contact-list">
      <li><span>Name</span><span>${lead.first} ${lead.last}</span></li>
      ${hasEmail ? `<li><span>Email</span><span>${lead.email}</span></li>` : ''}
      ${hasPhone ? `<li><span>Phone</span><span>${lead.phone}</span></li>` : ''}
    </ul>
    <div class="message">"${msg}"</div>
  </div>
  <div class="footer">YachtWorld.com &bull; Boats Group LLC &bull; Austin, TX &bull; Inquiry #YW-${seqNum.toString().padStart(7,'0')}</div>
</div>
</body></html>`
  };
}

function truecarEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'dealers@truecar.com',
    fromName: 'TrueCar Lead Notification',
    to: 'internet@dealership.com',
    subject: `TrueCar Lead — ${lead.first} ${lead.last} — ${car.year} ${car.make} ${car.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#F5F5F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
.container{max-width:600px;margin:20px auto;background:#fff;border-radius:6px;overflow:hidden;border:1px solid #e0e0e0}
.nav{background:#0072CE;padding:14px 22px;display:flex;align-items:center;gap:10px}
.nav-logo{color:#fff;font-size:20px;font-weight:900;letter-spacing:-1px}
.nav-badge{background:rgba(255,255,255,.2);color:#fff;font-size:11px;padding:3px 8px;border-radius:2px;border:1px solid rgba(255,255,255,.4)}
.hero{background:#E8F4FF;padding:18px 22px;border-bottom:1px solid #cde0f5}
.hero-title{font-size:16px;font-weight:700;color:#0072CE}
.hero-sub{font-size:12px;color:#5a7fa0;margin-top:3px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:0}
.col{padding:18px 22px}
.col+.col{border-left:1px solid #eee}
.col-title{font-size:11px;font-weight:700;text-transform:uppercase;color:#0072CE;letter-spacing:.5px;margin-bottom:12px}
.row{margin-bottom:8px}
.row-label{font-size:11px;color:#999}
.row-value{font-size:13px;font-weight:600;color:#111;margin-top:1px}
.vin-chip{display:inline-block;font-family:monospace;background:#eee;font-size:12px;padding:2px 8px;border-radius:3px}
.msg-area{padding:18px 22px;background:#FAFAFA;border-top:1px solid #eee}
.msg-title{font-size:11px;font-weight:700;text-transform:uppercase;color:#0072CE;letter-spacing:.5px;margin-bottom:8px}
.msg-text{font-size:13px;color:#444;line-height:1.65}
.footer{background:#0072CE;padding:10px 22px;font-size:11px;color:rgba(255,255,255,.7)}
</style></head>
<body>
<div class="container">
  <div class="nav">
    <span class="nav-logo">TrueCar</span>
    <span class="nav-badge">NEW LEAD</span>
  </div>
  <div class="hero">
    <div class="hero-title">New Buyer Lead — Act within 1 hour for best conversion</div>
    <div class="hero-sub">Received: ${dateStr}</div>
  </div>
  <div class="two-col">
    <div class="col">
      <div class="col-title">Vehicle</div>
      <div class="row"><div class="row-label">Year/Make/Model</div><div class="row-value">${car.year} ${car.make} ${car.model}</div></div>
      <div class="row"><div class="row-label">VIN</div><div class="row-value"><span class="vin-chip">${car.vin}</span></div></div>
      <div class="row"><div class="row-label">Stock #</div><div class="row-value">${car.stock}</div></div>
      <div class="row"><div class="row-label">Price</div><div class="row-value">${car.price}</div></div>
      <div class="row"><div class="row-label">Mileage</div><div class="row-value">${car.miles.toLocaleString()} mi</div></div>
    </div>
    <div class="col">
      <div class="col-title">Buyer</div>
      <div class="row"><div class="row-label">Name</div><div class="row-value">${lead.first} ${lead.last}</div></div>
      ${hasEmail ? `<div class="row"><div class="row-label">Email</div><div class="row-value">${lead.email}</div></div>` : ''}
      ${hasPhone ? `<div class="row"><div class="row-label">Phone</div><div class="row-value">${lead.phone}</div></div>` : ''}
      <div class="row"><div class="row-label">Lead ID</div><div class="row-value">TC-${seqNum.toString().padStart(8,'0')}</div></div>
    </div>
  </div>
  <div class="msg-area">
    <div class="msg-title">Buyer Message</div>
    <div class="msg-text">"${msg}"</div>
  </div>
  <div class="footer">TrueCar, Inc. &bull; Santa Monica, CA &bull; Lead #TC-${seqNum.toString().padStart(8,'0')}</div>
</div>
</body></html>`
  };
}

function edmundsEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'leads@edmunds.com',
    fromName: 'Edmunds Lead',
    to: 'internet@dealership.com',
    subject: `Edmunds.com — Price Quote Request: ${car.year} ${car.make} ${car.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;font-family:Arial,sans-serif;background:#f8f8f8}
.shell{max-width:600px;margin:20px auto;background:#fff;border:1px solid #ddd;border-radius:4px}
.topstrip{background:#F5821F;height:5px}
.h{padding:16px 22px;background:#fff;border-bottom:2px solid #F5821F;display:flex;align-items:center;gap:12px}
.h-logo{font-size:22px;font-weight:900;color:#F5821F}
.h-title{font-size:13px;color:#555}
.tbl{width:100%;border-collapse:collapse;margin:0}
.tbl th{background:#F5821F;color:#fff;font-size:11px;text-align:left;padding:9px 16px;letter-spacing:.3px}
.tbl td{padding:9px 16px;font-size:13px;border-bottom:1px solid #eee;vertical-align:top}
.tbl td:first-child{width:40%;color:#777;font-weight:normal}
.tbl td:last-child{font-weight:600;color:#111}
.mono{font-family:monospace;font-size:12px;background:#f5f5f5;padding:1px 5px;border-radius:2px}
.msgblock{padding:18px 22px;background:#fff9f4;border-top:1px solid #f0e0d0}
.msgtitle{font-size:12px;font-weight:bold;color:#F5821F;text-transform:uppercase;margin-bottom:8px}
.msgtext{font-size:13px;color:#444;line-height:1.65}
.foot{padding:10px 22px;background:#F5821F;font-size:11px;color:rgba(255,255,255,.8)}
</style></head>
<body>
<div class="shell">
  <div class="topstrip"></div>
  <div class="h">
    <div class="h-logo">Edmunds</div>
    <div class="h-title">New Price Quote Request — ${dateStr}</div>
  </div>
  <table class="tbl">
    <tr><th colspan="2">Vehicle Information</th></tr>
    <tr><td>Vehicle</td><td>${car.year} ${car.make} ${car.model}</td></tr>
    <tr><td>VIN</td><td><span class="mono">${car.vin}</span></td></tr>
    <tr><td>Stock Number</td><td>${car.stock}</td></tr>
    <tr><td>Listed Price</td><td>${car.price}</td></tr>
    <tr><td>Mileage</td><td>${car.miles.toLocaleString()} miles</td></tr>
    <tr><td>Exterior</td><td>${car.color}</td></tr>
    <tr><th colspan="2">Customer Information</th></tr>
    <tr><td>Name</td><td>${lead.first} ${lead.last}</td></tr>
    ${hasEmail ? `<tr><td>Email</td><td>${lead.email}</td></tr>` : ''}
    ${hasPhone ? `<tr><td>Phone</td><td>${lead.phone}</td></tr>` : ''}
    <tr><td>Lead Source</td><td>Edmunds.com</td></tr>
    <tr><td>Reference ID</td><td>EDM-${seqNum.toString().padStart(8,'0')}</td></tr>
  </table>
  <div class="msgblock">
    <div class="msgtitle">Customer Message</div>
    <div class="msgtext">"${msg}"</div>
  </div>
  <div class="foot">Edmunds &bull; Santa Monica, CA &bull; edmunds.com &bull; Ref: EDM-${seqNum.toString().padStart(8,'0')}</div>
</div>
</body></html>`
  };
}

function iseecarEmail(lead, car, msgIndex, dateStr, seqNum) {
  const msg = messages[msgIndex % messages.length];
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  return {
    from: 'noreply@iseecars.com',
    fromName: 'iSeeCars Lead',
    to: 'sales@dealership.com',
    subject: `iSeeCars — Buyer Inquiry: ${car.year} ${car.make} ${car.model}`,
    date: dateStr,
    body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#FAFAFA;font-family:Verdana,Arial,sans-serif;font-size:13px}
.wrap{max-width:580px;margin:20px auto;background:#fff;border:1px solid #ddd}
.bar{background:#2E7D32;padding:14px 20px;color:#fff;font-size:18px;font-weight:bold}
.bar span{font-size:12px;background:rgba(255,255,255,.2);padding:3px 8px;border-radius:3px;margin-left:8px;vertical-align:middle;font-weight:normal}
.inner{padding:20px}
.car-info{background:#E8F5E9;border-radius:4px;padding:14px;margin-bottom:16px}
.car-name{font-size:15px;font-weight:bold;color:#1B5E20;margin-bottom:8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px}
.gi label{font-size:10px;color:#777;display:block;text-transform:uppercase}
.gi span{font-size:12px;font-weight:bold;color:#1B5E20}
.contact-box{border:1px solid #ddd;border-radius:4px;padding:14px;margin-bottom:16px}
.cbtitle{font-size:11px;font-weight:bold;text-transform:uppercase;color:#2E7D32;margin-bottom:10px}
.cb-row{display:flex;margin-bottom:6px}
.cb-row label{width:100px;font-size:12px;color:#777}
.cb-row span{font-size:12px;font-weight:bold;color:#222}
.msgwrap{border-top:2px solid #2E7D32;padding-top:14px}
.msglbl{font-size:11px;font-weight:bold;text-transform:uppercase;color:#2E7D32;margin-bottom:6px}
.msgcont{font-size:13px;color:#444;line-height:1.6}
.foot{background:#2E7D32;padding:10px 20px;font-size:11px;color:rgba(255,255,255,.75);margin-top:16px}
</style></head>
<body>
<div class="wrap">
  <div class="bar">iSeeCars <span>New Lead</span></div>
  <div class="inner">
    <div class="car-info">
      <div class="car-name">${car.year} ${car.make} ${car.model}</div>
      <div class="grid">
        <div class="gi"><label>VIN</label><span>${car.vin}</span></div>
        <div class="gi"><label>Stock #</label><span>${car.stock}</span></div>
        <div class="gi"><label>Price</label><span>${car.price}</span></div>
        <div class="gi"><label>Miles</label><span>${car.miles.toLocaleString()}</span></div>
        <div class="gi"><label>Color</label><span>${car.color}</span></div>
      </div>
    </div>
    <div class="contact-box">
      <div class="cbtitle">Shopper Details</div>
      <div class="cb-row"><label>Name</label><span>${lead.first} ${lead.last}</span></div>
      ${hasEmail ? `<div class="cb-row"><label>Email</label><span>${lead.email}</span></div>` : ''}
      ${hasPhone ? `<div class="cb-row"><label>Phone</label><span>${lead.phone}</span></div>` : ''}
      <div class="cb-row"><label>Ref #</label><span>ISC-${seqNum.toString().padStart(7,'0')}</span></div>
    </div>
    <div class="msgwrap">
      <div class="msglbl">Their Message</div>
      <div class="msgcont">"${msg}"</div>
    </div>
  </div>
  <div class="foot">iSeeCars.com &bull; Newton, MA &bull; Lead #ISC-${seqNum.toString().padStart(7,'0')} &bull; ${dateStr}</div>
</div>
</body></html>`
  };
}

// ── Assignment table — 50 emails ──────────────────────────────────────────────
// Format: [sourceFunc, vehicleType, vehicleIndex, leadIndex, msgIndex, dateOffset]
const assignments = [
  // CarGurus — 10
  [cargurusEmail,  'car',  0,  0,  0,   0],
  [cargurusEmail,  'car',  1,  1,  1,   1],
  [cargurusEmail,  'car',  2,  2,  2,   2],
  [cargurusEmail,  'car',  3,  3,  3,   3],
  [cargurusEmail,  'car',  4,  4,  4,   4],
  [cargurusEmail,  'car',  5,  5,  5,   5],
  [cargurusEmail,  'car',  6,  6,  6,   6],
  [cargurusEmail,  'car',  7,  7,  7,   7],
  [cargurusEmail,  'car',  8,  8,  8,   8],
  [cargurusEmail,  'car',  9,  9,  9,   9],
  // Cars.com — 8
  [carsDotComEmail,'car', 10, 10,  0,  10],
  [carsDotComEmail,'car', 11, 11,  2,  11],
  [carsDotComEmail,'car', 12, 12,  4,  12],
  [carsDotComEmail,'car', 13, 13,  6,  13],
  [carsDotComEmail,'car', 14, 14,  8,  14],
  [carsDotComEmail,'car', 15, 15, 10,  15],
  [carsDotComEmail,'car', 16, 16, 12,  16],
  [carsDotComEmail,'car', 17, 17,  1,  17],
  // AutoTrader — 8
  [autotraderEmail,'car', 18, 18,  3,  18],
  [autotraderEmail,'car', 19, 19,  5,  19],
  [autotraderEmail,'car', 20, 20,  7,  20],
  [autotraderEmail,'car', 21, 21,  9,  21],
  [autotraderEmail,'car', 22, 22, 11,  22],
  [autotraderEmail,'car', 23, 23, 13,  23],
  [autotraderEmail,'car', 24, 24,  0,  24],
  [autotraderEmail,'car',  0, 25,  2,  25],
  // BoatTrader — 8
  [boattraderEmail,'boat', 0, 26,  0,  26],
  [boattraderEmail,'boat', 1, 27,  1,  27],
  [boattraderEmail,'boat', 2, 28,  2,  28],
  [boattraderEmail,'boat', 3, 29,  3,  29],
  [boattraderEmail,'boat', 4, 30,  4,  30],
  [boattraderEmail,'boat', 5, 31,  5,  31],
  [boattraderEmail,'boat', 6, 32,  0,  32],
  [boattraderEmail,'boat', 7, 33,  1,  33],
  // Boats.com — 6
  [boatsDotComEmail,'boat', 8, 34,  2,  34],
  [boatsDotComEmail,'boat', 9, 35,  3,  35],
  [boatsDotComEmail,'boat',10, 36,  4,  36],
  [boatsDotComEmail,'boat',11, 37,  5,  37],
  [boatsDotComEmail,'boat', 0, 38,  0,  38],
  [boatsDotComEmail,'boat', 1, 39,  1,  39],
  // YachtWorld — 4
  [yachtworldEmail,'boat',  2, 40,  2,  40],
  [yachtworldEmail,'boat',  5, 41,  4,  41],
  [yachtworldEmail,'boat',  8, 42,  5,  42],
  [yachtworldEmail,'boat', 11, 43,  3,  43],
  // TrueCar — 6
  [truecarEmail,  'car',   1, 44,  7,  44],
  [truecarEmail,  'car',   3, 45,  9,  45],
  [truecarEmail,  'car',   5, 46, 11,  46],
  [truecarEmail,  'car',   7, 47,  0,  47],
  // Edmunds — 4
  [edmundsEmail,  'car',   9, 48,  3,  48],
  [edmundsEmail,  'car',  11, 49,  6,  49],
  // iSeeCars — 2
  [iseecarEmail,  'car',  13,  0, 12,  50],
  [iseecarEmail,  'car',  15,  2, 14,  51],
];

// ── Generate files ────────────────────────────────────────────────────────────

function isoDate(offset) {
  const d = new Date('2026-05-28T09:00:00Z');
  d.setHours(d.getHours() + offset * 7 + Math.floor(Math.random() * 8));
  return d.toUTCString();
}

assignments.forEach(([fn, vehicleType, vehicleIdx, leadIdx, msgIdx, dateOffset], i) => {
  const vehicle = vehicleType === 'car' ? cars[vehicleIdx % cars.length] : boats[vehicleIdx % boats.length];
  const lead = leads[leadIdx % leads.length];
  const dateStr = isoDate(i);
  const seqNum = 1000000 + i;
  const email = fn(lead, vehicle, msgIdx, dateStr, seqNum);

  const emlContent = [
    `From: "${email.fromName}" <${email.from}>`,
    `To: ${email.to}`,
    `Subject: ${email.subject}`,
    `Date: ${email.date}`,
    `Message-ID: <${seqNum}.${Date.now()}@${email.from.split('@')[1]}>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    email.body,
  ].join('\r\n');

  const filename = `${String(i + 1).padStart(2, '0')}-${email.from.split('@')[1].replace('.','_')}-${lead.last.toLowerCase().replace(/[^a-z]/g,'')}.eml`;
  fs.writeFileSync(path.join(OUT_DIR, filename), emlContent, 'utf8');
  console.log(`  [${i+1}/50] ${filename}`);
});

console.log(`\nDone — ${assignments.length} .eml files written to sample-emails/`);
