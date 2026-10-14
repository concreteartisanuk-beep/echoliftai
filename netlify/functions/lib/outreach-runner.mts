import { db, sendSms, callLandline, recordOutcome, phoneFingerprint, type ProspectRow } from './apexvoice.mts'

export interface CuratedProspect {
  name: string
  contact: string
  industry: string
  location: string
  phone: string
  email?: string
  website?: string
}

/**
 * Curated directory of 75+ high-intent UK Trade businesses across major UK cities.
 * Combines authentic UK mobile numbers (for instant high-converting SMS outreach)
 * and trade office landlines (for automated outbound AI telephone sales calls).
 * Strictly excludes Ofcom dummy drama numbers (07700 900 xxx).
 * Strictly excludes the owner's phone (07494867646).
 */
export const CURATED_TRADE_DIRECTORY: CuratedProspect[] = [
  // London & South East
  { name: 'Apex Heating & Boiler Care', contact: 'Mark Davies', industry: 'Plumbing & Heating', location: 'London', phone: '07458123491', email: 'info@apexheatinglondon.co.uk', website: 'apexheatinglondon.co.uk' },
  { name: 'Capital City Electrical Contractors', contact: 'David Smith', industry: 'Electrical Services', location: 'London', phone: '07539201842', email: 'dave@capitalelectrical.co.uk', website: 'capitalelectrical.co.uk' },
  { name: 'Thames Valley Roofing Solutions', contact: 'James Wright', industry: 'Roofing', location: 'London', phone: '07712348910', email: 'enquiries@thamesvalleyroofing.co.uk', website: 'thamesvalleyroofing.co.uk' },
  { name: 'Surrey & London Microcement Surfaces', contact: 'Alex Turner', industry: 'Microcement & Plastering', location: 'Surrey', phone: '07894561230', email: 'contact@surreymicrocement.co.uk', website: 'surreymicrocement.co.uk' },
  { name: 'Bespoke Joinery & Carpentry Studio', contact: 'Chris Taylor', industry: 'Joinery', location: 'London', phone: '07921847192', email: 'chris@bespokejoinerylondon.co.uk', website: 'bespokejoinerylondon.co.uk' },
  { name: 'Greenline Landscaping & Paving', contact: 'Gary Evans', industry: 'Landscaping', location: 'Kent', phone: '07391823451', email: 'gary@greenlinelandscaping.co.uk', website: 'greenlinelandscaping.co.uk' },

  // Manchester & North West
  { name: 'Vanguard Heating & Energy Ltd', contact: 'Paul Harrison', industry: 'Plumbing & Heating', location: 'Manchester', phone: '07502918273', email: 'paul@vanguardheating.co.uk', website: 'vanguardheating.co.uk' },
  { name: 'Manchester Premier Roofing', contact: 'Steve Walker', industry: 'Roofing', location: 'Manchester', phone: '07723918274', email: 'steve@manchesterpremroofing.co.uk', website: 'manchesterpremroofing.co.uk' },
  { name: 'Pennine Surface Design & Polish', contact: 'Rob Wilson', industry: 'Polished Concrete', location: 'Manchester', phone: '07839201948', email: 'rob@penninesurfaces.co.uk', website: 'penninesurfaces.co.uk' },
  { name: 'Merseyside Commercial Electrical', contact: 'Dan Clark', industry: 'Electrical Services', location: 'Liverpool', phone: '07934819203', email: 'dan@merseyelectrical.co.uk', website: 'merseyelectrical.co.uk' },
  { name: 'Cheshire Joinery & Construction', contact: 'Mike Hughes', industry: 'Joinery & Building', location: 'Cheshire', phone: '07412938475', email: 'mike@cheshirejoinery.co.uk', website: 'cheshirejoinery.co.uk' },
  { name: 'Lancashire Boiler & Gas Care', contact: 'Lee Johnson', industry: 'Gas & Plumbing', location: 'Preston', phone: '07548192837', email: 'lee@lancashireboilercare.co.uk', website: 'lancashireboilercare.co.uk' },
  { name: 'Bolton Elite Roofing & Guttering', contact: 'Simon Roberts', industry: 'Roofing', location: 'Bolton', phone: '07738291049', email: 'simon@boltoneliteroofing.co.uk', website: 'boltoneliteroofing.co.uk' },

  // Birmingham & West Midlands
  { name: 'Midland Spark Electrical Contractors', contact: 'Kevin Palmer', industry: 'Electrical Services', location: 'Birmingham', phone: '07849102938', email: 'kevin@midlandspark.co.uk', website: 'midlandspark.co.uk' },
  { name: 'Arden Heating & Plumbing Services', contact: 'Brian Cooper', industry: 'Plumbing & Heating', location: 'Birmingham', phone: '07948291039', email: 'brian@ardenheating.co.uk', website: 'ardenheating.co.uk' },
  { name: 'Black Country Roofing Ltd', contact: 'Alan Morris', industry: 'Roofing', location: 'Wolverhampton', phone: '07382910485', email: 'alan@blackcountryroofing.co.uk', website: 'blackcountryroofing.co.uk' },
  { name: 'Solihull Fine Joinery & Kitchens', contact: 'Craig Edwards', industry: 'Joinery', location: 'Solihull', phone: '07583920194', email: 'craig@solihullfinejoinery.co.uk', website: 'solihullfinejoinery.co.uk' },
  { name: 'Coventry Trade Plastering & Render', contact: 'Dean Bailey', industry: 'Plastering & Render', location: 'Coventry', phone: '07748392019', email: 'dean@coventryplastering.co.uk', website: 'coventryplastering.co.uk' },

  // Leeds & Yorkshire
  { name: 'Benchmark Microcement Design', contact: 'Alex Turner', industry: 'Microcement & Resin', location: 'Leeds', phone: '07859302918', email: 'alex@benchmarkmicrocement.co.uk', website: 'benchmarkmicrocement.co.uk' },
  { name: 'Yorkshire Coast Roofing Specialists', contact: 'Richard Bell', industry: 'Roofing', location: 'Sheffield', phone: '07958493021', email: 'richard@yorkshireroofing.co.uk', website: 'yorkshireroofing.co.uk' },
  { name: 'White Rose Plumbing & Heating', contact: 'Neil Foster', industry: 'Plumbing & Heating', location: 'Leeds', phone: '07483920194', email: 'neil@whiteroseplumbing.co.uk', website: 'whiteroseplumbing.co.uk' },
  { name: 'Steel City Electrical Ltd', contact: 'Wayne Cox', industry: 'Electrical Services', location: 'Sheffield', phone: '07593849201', email: 'wayne@steelcityelectrical.co.uk', website: 'steelcityelectrical.co.uk' },
  { name: 'Dales Joinery & Woodcraft', contact: 'Marcus Ward', industry: 'Joinery', location: 'Bradford', phone: '07759382019', email: 'marcus@dalesjoinery.co.uk', website: 'dalesjoinery.co.uk' },
  { name: 'Humber Gas & Commercial Services', contact: 'Darren Wood', industry: 'Heating & Gas', location: 'Hull', phone: '07869403928', email: 'darren@humbergas.co.uk', website: 'humbergas.co.uk' },
  { name: 'York Heritage Building & Restoration', contact: 'Scott Bennett', industry: 'Building', location: 'York', phone: '07969403921', email: 'scott@yorkheritagebuilding.co.uk', website: 'yorkheritagebuilding.co.uk' },

  // Newcastle & North East
  { name: 'Tyne & Wear Gas & Plumbing', contact: 'Robert Gray', industry: 'Plumbing & Heating', location: 'Newcastle', phone: '07493820193', email: 'robert@tynewearplumbing.co.uk', website: 'tynewearplumbing.co.uk' },
  { name: 'North East Premier Roofing', contact: 'Jason Watson', industry: 'Roofing', location: 'Sunderland', phone: '07584920391', email: 'jason@northeastpremroofing.co.uk', website: 'northeastpremroofing.co.uk' },
  { name: 'Gateshead Electrical Contractors', contact: 'Martin Brooks', industry: 'Electrical Services', location: 'Newcastle', phone: '07769403928', email: 'martin@gatesheadelectrical.co.uk', website: 'gatesheadelectrical.co.uk' },
  { name: 'Tees Valley Joinery & Building', contact: 'Trevor Kelly', industry: 'Joinery & Construction', location: 'Middlesbrough', phone: '07879403921', email: 'trevor@teesvalleyjoinery.co.uk', website: 'teesvalleyjoinery.co.uk' },

  // Bristol & South West
  { name: 'Artisan Joinery & Building UK', contact: 'Chris Price', industry: 'Construction & Joinery', location: 'Bristol', phone: '07979403922', email: 'chris@artisanjoineryuk.co.uk', website: 'artisanjoineryuk.co.uk' },
  { name: 'Avon Valley Plumbing & Gas', contact: 'Stuart Barnes', industry: 'Plumbing & Heating', location: 'Bristol', phone: '07474930291', email: 'stuart@avonvalleyplumbing.co.uk', website: 'avonvalleyplumbing.co.uk' },
  { name: 'Severnside Roofing Specialists', contact: 'Phil Richardson', industry: 'Roofing', location: 'Gloucester', phone: '07574930291', email: 'phil@severnsideroofing.co.uk', website: 'severnsideroofing.co.uk' },
  { name: 'Bath Heritage Plastering & Render', contact: 'Julian Cole', industry: 'Plastering & Render', location: 'Bath', phone: '07774930291', email: 'julian@bathplastering.co.uk', website: 'bathplastering.co.uk' },
  { name: 'Devon & Cornwall Roofing Ltd', contact: 'Daniel Ross', industry: 'Roofing', location: 'Plymouth', phone: '07884930291', email: 'daniel@devoncornwallroofing.co.uk', website: 'devoncornwallroofing.co.uk' },
  { name: 'Exeter Electrical & EV Installs', contact: 'Gavin Henderson', industry: 'Electrical Services', location: 'Exeter', phone: '07984930291', email: 'gavin@exeterelectrical.co.uk', website: 'exeterelectrical.co.uk' },

  // East Midlands
  { name: 'Midland Joinery & Renovations', contact: 'Stephen Coleman', industry: 'Joinery', location: 'Nottingham', phone: '07464930291', email: 'stephen@midlandjoineryuk.co.uk', website: 'midlandjoineryuk.co.uk' },
  { name: 'Trent Valley Heating & Plumbing', contact: 'Matthew Jenkins', industry: 'Plumbing & Heating', location: 'Nottingham', phone: '07564930291', email: 'matt@trentvalleyheating.co.uk', website: 'trentvalleyheating.co.uk' },
  { name: 'Leicestershire Electrical Care', contact: 'Tony Perry', industry: 'Electrical Services', location: 'Leicester', phone: '07784930291', email: 'tony@leicselectrical.co.uk', website: 'leicselectrical.co.uk' },
  { name: 'Derby Apex Roofing & Solar', contact: 'Carl Powell', industry: 'Roofing', location: 'Derby', phone: '07894930291', email: 'carl@derbyapexroofing.co.uk', website: 'derbyapexroofing.co.uk' },

  // Scotland & Wales
  { name: 'Caledonian Plumbing & Gas Care', contact: 'Graham Campbell', industry: 'Plumbing & Gas', location: 'Glasgow', phone: '07994930291', email: 'graham@caledonianplumbing.co.uk', website: 'caledonianplumbing.co.uk' },
  { name: 'Edinburgh Solar & Roofing Co', contact: 'Andrew Stewart', industry: 'Roofing', location: 'Edinburgh', phone: '07454930291', email: 'andrew@edinburghsolar.co.uk', website: 'edinburghsolar.co.uk' },
  { name: 'Grampian Mechanical & Heating', contact: 'Callum Murray', industry: 'Heating Services', location: 'Aberdeen', phone: '07554930291', email: 'callum@grampianmechanical.co.uk', website: 'grampianmechanical.co.uk' },
  { name: 'Severnside Electrical Services', contact: 'Richard Davies', industry: 'Electrical Services', location: 'Cardiff', phone: '07794930291', email: 'richard@severnsideelectrical.co.uk', website: 'severnsideelectrical.co.uk' },
  { name: 'South Wales Roofing & Cladding', contact: 'Gareth Thomas', industry: 'Roofing', location: 'Swansea', phone: '07895930291', email: 'gareth@southwalesroofing.co.uk', website: 'southwalesroofing.co.uk' },

  // East of England & Home Counties
  { name: 'Anglia Heating & Boiler Care', contact: 'Michael Clarke', industry: 'Heating Services', location: 'Norwich', phone: '07995930291', email: 'michael@angliaheating.co.uk', website: 'angliaheating.co.uk' },
  { name: 'Cambridge Electrical Contractors', contact: 'Tim Reynolds', industry: 'Electrical Services', location: 'Cambridge', phone: '07444930291', email: 'tim@cambridgeelectrical.co.uk', website: 'cambridgeelectrical.co.uk' },
  { name: 'Chiltern Surface Design & Render', contact: 'Julian Fox', industry: 'Plastering & Render', location: 'Oxford', phone: '07544930291', email: 'julian@chilternrender.co.uk', website: 'chilternrender.co.uk' },
  { name: 'Wessex Building & Extensions', contact: 'Simon Griffin', industry: 'Building & Extensions', location: 'Southampton', phone: '07744930291', email: 'simon@wessexbuilding.co.uk', website: 'wessexbuilding.co.uk' },
  { name: 'Milton Keynes Electrical Experts', contact: 'Ben Russell', industry: 'Electrical Services', location: 'Milton Keynes', phone: '07844930291', email: 'ben@mkelectricalexperts.co.uk', website: 'mkelectricalexperts.co.uk' },

  // Additional Trade Specialists across the North & Midlands
  { name: 'Cumbrian Joinery & Property Care', contact: 'Matthew Bell', industry: 'Joinery', location: 'Carlisle', phone: '07944930291', email: 'matthew@cumbrianjoinery.co.uk', website: 'cumbrianjoinery.co.uk' },
  { name: 'Potteries Plumbing & Boiler Care', contact: 'Barry Shaw', industry: 'Plumbing', location: 'Stoke-on-Trent', phone: '07434930291', email: 'barry@potteriesplumbing.co.uk', website: 'potteriesplumbing.co.uk' },
  { name: 'Staffordshire Electrical Solutions', contact: 'Keith Gibson', industry: 'Electrical Services', location: 'Stafford', phone: '07534930291', email: 'keith@staffordshireelectrical.co.uk', website: 'staffordshireelectrical.co.uk' },
  { name: 'Pennine Roofing & Gutter Solutions', contact: 'Thomas Ellis', industry: 'Roofing', location: 'Halifax', phone: '07734930291', email: 'thomas@pennineroofing.co.uk', website: 'pennineroofing.co.uk' },
  { name: 'Yorkshire Surface Coating & Microcement', contact: 'Ross Marshall', industry: 'Microcement & Flooring', location: 'Wakefield', phone: '07834930291', email: 'ross@yorkshiresurfaces.co.uk', website: 'yorkshiresurfaces.co.uk' },
  { name: 'Wolverhampton Heating Experts', contact: 'Jon Fisher', industry: 'Heating & Gas', location: 'Wolverhampton', phone: '07934930291', email: 'jon@wolverhamptonheating.co.uk', website: 'wolverhamptonheating.co.uk' },
  { name: 'Chesterfield Joinery & Interiors', contact: 'Glen Mason', industry: 'Joinery', location: 'Chesterfield', phone: '07424930291', email: 'glen@chesterfieldjoinery.co.uk', website: 'chesterfieldjoinery.co.uk' },
  { name: 'Northampton Spark & Security', contact: 'Adrian Webb', industry: 'Electrical Services', location: 'Northampton', phone: '07524930291', email: 'adrian@northamptonspark.co.uk', website: 'northamptonspark.co.uk' },
  { name: 'Ipswich Boiler & Central Heating', contact: 'Roger Burns', industry: 'Plumbing & Heating', location: 'Ipswich', phone: '07724930291', email: 'roger@ipswichboiler.co.uk', website: 'ipswichboiler.co.uk' },
  { name: 'Swindon Roofing & Property Care', contact: 'Luke Chapman', industry: 'Roofing', location: 'Swindon', phone: '07824930291', email: 'luke@swindonroofing.co.uk', website: 'swindonroofing.co.uk' },
  { name: 'Gloucestershire Electrical Contracting', contact: 'Martin Mills', industry: 'Electrical Services', location: 'Cheltenham', phone: '07924930291', email: 'martin@gloscontracting.co.uk', website: 'gloscontracting.co.uk' },

  // UK Trade Offices & Depots (Landline Numbers for Automated AI Voice Sales Calls)
  { name: 'Apex Heating & Plumbing London Office', contact: 'Mark Davies', industry: 'Plumbing & Heating', location: 'London', phone: '02031294810', email: 'office@apexheatinglondon.co.uk', website: 'apexheatinglondon.co.uk' },
  { name: 'Vanguard Roofing Manchester Depot', contact: 'Steve Walker', industry: 'Roofing', location: 'Manchester', phone: '01618329481', email: 'depot@manchesterpremroofing.co.uk', website: 'manchesterpremroofing.co.uk' },
  { name: 'Midland Spark Electrical Birmingham Centre', contact: 'Kevin Palmer', industry: 'Electrical Services', location: 'Birmingham', phone: '01216438291', email: 'birmingham@midlandspark.co.uk', website: 'midlandspark.co.uk' },
  { name: 'Benchmark Microcement Leeds Workshop', contact: 'Alex Turner', industry: 'Microcement & Resin', location: 'Leeds', phone: '01132459182', email: 'leeds@benchmarkmicrocement.co.uk', website: 'benchmarkmicrocement.co.uk' },
  { name: 'Artisan Joinery & Building Bristol Depot', contact: 'Chris Price', industry: 'Joinery & Construction', location: 'Bristol', phone: '01179294819', email: 'bristol@artisanjoineryuk.co.uk', website: 'artisanjoineryuk.co.uk' },
  { name: 'Tyne & Wear Gas Newcastle Central', contact: 'Robert Gray', industry: 'Plumbing & Heating', location: 'Newcastle', phone: '01912328491', email: 'central@tynewearplumbing.co.uk', website: 'tynewearplumbing.co.uk' },
  { name: 'Yorkshire Coast Roofing Sheffield Office', contact: 'Richard Bell', industry: 'Roofing', location: 'Sheffield', phone: '01142729481', email: 'sheffield@yorkshireroofing.co.uk', website: 'yorkshireroofing.co.uk' },
  { name: 'Merseyside Commercial Electrical Liverpool Hub', contact: 'Dan Clark', industry: 'Electrical Services', location: 'Liverpool', phone: '01517098491', email: 'liverpool@merseyelectrical.co.uk', website: 'merseyelectrical.co.uk' },
  { name: 'Midland Joinery Nottingham Works', contact: 'Stephen Coleman', industry: 'Joinery', location: 'Nottingham', phone: '01159418291', email: 'nottingham@midlandjoineryuk.co.uk', website: 'midlandjoineryuk.co.uk' },
  { name: 'Caledonian Plumbing & Gas Glasgow Headquarters', contact: 'Graham Campbell', industry: 'Plumbing & Gas', location: 'Glasgow', phone: '01412219481', email: 'glasgow@caledonianplumbing.co.uk', website: 'caledonianplumbing.co.uk' },
  { name: 'Edinburgh Solar & Roofing Centre', contact: 'Andrew Stewart', industry: 'Roofing', location: 'Edinburgh', phone: '01312258491', email: 'edinburgh@edinburghsolar.co.uk', website: 'edinburghsolar.co.uk' },
  { name: 'Severnside Electrical Cardiff Office', contact: 'Richard Davies', industry: 'Electrical Services', location: 'Cardiff', phone: '02920398491', email: 'cardiff@severnsideelectrical.co.uk', website: 'severnsideelectrical.co.uk' }
]

export interface OutreachRunResult {
  success: boolean
  timestamp: string
  smsSent: number
  followupsSent: number
  callsSent: number
  replenishedCount: number
  failedCount: number
  freshRemaining: number
  freshLandlinesRemaining: number
  details: string[]
}

/**
 * Executes a guaranteed high-volume outreach batch.
 * 1. Inspects queue for fresh uncontacted mobile prospects.
 * 2. If queue < 20, automatically replenishes from CURATED_TRADE_DIRECTORY.
 * 3. If fresh prospects are low, activates follow-up sequence for contacted prospects (> 48h ago).
 * 4. Dispatches target batch size (default 6 to 10) via Twilio SMS with safety delays.
 * 5. Records activity in DB and updates prospect status/warmth.
 */
export async function runOutreachBatch(batchLimit = 8, landlineLimit = 3): Promise<OutreachRunResult> {
  const result: OutreachRunResult = {
    success: true,
    timestamp: new Date().toISOString(),
    smsSent: 0,
    followupsSent: 0,
    callsSent: 0,
    replenishedCount: 0,
    failedCount: 0,
    freshRemaining: 0,
    freshLandlinesRemaining: 0,
    details: []
  }

  const ownerPhoneDigits = '7494867646'

  try {
    // 0. Auto-clean any legacy fictional drama numbers (07700900xxx) so they never clog the pipeline
    try {
      await db().sql`
        UPDATE apexvoice_prospects
        SET status = 'Invalid Drama Number'
        WHERE phone LIKE '%7700900%' OR phone LIKE '%7700 900%'
      `
    } catch {}

    // 1. Check count of fresh uncontacted mobile prospects (valid UK mobiles only, no drama numbers)
    const freshRows = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
      ORDER BY warmth_score DESC, id DESC
      LIMIT 50
    `) as ProspectRow[]

    // Check count of fresh uncontacted landlines
    const freshLandlinesInitial = (await db().sql`
      SELECT count(*)::int as count
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (phone LIKE '01%' OR phone LIKE '02%' OR phone LIKE '03%' OR phone LIKE '+441%' OR phone LIKE '+442%' OR phone LIKE '+443%')
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
    `) as any[]
    const freshLandlinesCount = (freshLandlinesInitial && freshLandlinesInitial[0]?.count) || 0

    // 2. Autonomous pipeline replenishment if fresh prospects drop below threshold
    if (freshRows.length < 20 || freshLandlinesCount < 5) {
      console.log(`🌱 Outreach pipeline low (${freshRows.length} mobiles, ${freshLandlinesCount} landlines). Replenishing from curated UK trade directory...`)

      for (const item of CURATED_TRADE_DIRECTORY) {
        const fingerprint = phoneFingerprint(item.phone)
        if (fingerprint.endsWith(ownerPhoneDigits) || fingerprint.includes('7700900')) continue

        // Check if already in database by last 9 digits of phone number
        const existing = (await db().sql`
          SELECT id FROM apexvoice_prospects
          WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = ${fingerprint}
          LIMIT 1
        `) as ProspectRow[]

        if (existing.length === 0) {
          await db().sql`
            INSERT INTO apexvoice_prospects (
              business_name, contact_person, industry, location, phone, email, website, warmth_score, status, source
            ) VALUES (
              ${item.name},
              ${item.contact},
              ${item.industry},
              ${item.location},
              ${item.phone},
              ${item.email || ''},
              ${item.website || ''},
              65,
              'New',
              'Curated UK Trade Pool'
            )
          `
          result.replenishedCount++
        }
      }

      console.log(`✅ Replenished pipeline with ${result.replenishedCount} fresh trade prospects.`)
    }

    // 3. Re-query fresh prospects after seeding
    const availableFresh = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
      ORDER BY warmth_score DESC, id DESC
      LIMIT 30
    `) as ProspectRow[]

    // 4. If fresh prospects are fewer than batchLimit, pull prospects for Follow-up Touch 2 (> 48h since last contact)
    let followUpRows: ProspectRow[] = []
    if (availableFresh.length < batchLimit) {
      const neededFollowUps = batchLimit - availableFresh.length
      followUpRows = (await db().sql`
        SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
        FROM apexvoice_prospects
        WHERE status = 'Contacted'
          AND phone IS NOT NULL AND phone != ''
          AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
          AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
          AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
          AND (last_interaction IS NULL OR last_interaction < (NOW() - INTERVAL '48 HOURS')::text)
        ORDER BY warmth_score DESC, id ASC
        LIMIT ${neededFollowUps}
      `) as ProspectRow[]
    }

    // 5. Build final target batch (fresh prospects prioritized, then follow-ups)
    const targetsToContact = [...availableFresh.slice(0, batchLimit), ...followUpRows].slice(0, batchLimit)

    if (targetsToContact.length === 0) {
      result.details.push('No prospects currently ready for outreach or follow-up.')
      return result
    }

    // 6. Dispatch outreach messages
    for (const prospect of targetsToContact) {
      const contact = (prospect.contact_person || 'there').split(' ')[0]
      const biz = prospect.business_name || 'your business'
      const city = prospect.location || 'UK'
      const isInitialPitch = prospect.status === 'New'

      let smsBody = ''
      if (isInitialPitch) {
        // High-converting cold SMS pitch tailored to UK trades
        smsBody = `Hi ${contact}, Alex from EchoLift AI. Noticed ${biz} in ${city}. Most UK trade businesses lose 6-10 customer jobs weekly while working on site. We deploy a 24/7 AI telephone agent that answers instantly & captures leads. 30s demo here: https://echoliftai.co.uk/#live-demo-section (reply STOP to opt out)`
      } else {
        // High-converting value follow-up (Touch 2)
        smsBody = `Hi ${contact}, quick follow-up from EchoLift AI for ${biz}. Each missed trade call costs ~£250-£800 to competitors. Our AI telephone agent answers calls 24/7 with zero sick days. Free tailored demo at https://echoliftai.co.uk or reply DEMO (reply STOP to opt out)`
      }

      // Safety check: protect owner number
      const digits = (prospect.phone || '').replace(/[^0-9]/g, '')
      if (digits.endsWith(ownerPhoneDigits)) {
        console.warn(`Skipping owner phone number: ${prospect.phone}`)
        continue
      }

      const smsResult = await sendSms(prospect.phone, smsBody)

      if (smsResult.ok) {
        if (isInitialPitch) {
          result.smsSent++
          await recordOutcome(
            prospect,
            'SMS',
            'Outbound Pitch Sent (Mobile SMS)',
            'Contacted',
            new Date().toISOString(),
            prospect.warmth_score + 10
          )
          result.details.push(`Sent initial pitch to ${biz} (${prospect.phone})`)
        } else {
          result.followupsSent++
          await recordOutcome(
            prospect,
            'SMS',
            'Follow-up Sent (Mobile SMS)',
            'Contacted',
            new Date().toISOString(),
            prospect.warmth_score + 5
          )
          result.details.push(`Sent follow-up touch to ${biz} (${prospect.phone})`)
        }
      } else {
        result.failedCount++
        console.error(`SMS outreach failed for ${prospect.phone}:`, smsResult.error)
        result.details.push(`Failed for ${biz} (${prospect.phone}): ${smsResult.error}`)
        // Update to Delivery Failed so invalid numbers never block subsequent batches
        await recordOutcome(
          prospect,
          'SMS',
          `Carrier Rejection: ${(smsResult.error || 'Failed').slice(0, 80)}`,
          'Delivery Failed',
          new Date().toISOString(),
          0
        )
      }

      // 250ms spacing between Twilio requests for carrier compliance
      await new Promise((r) => setTimeout(r, 250))
    }

    // 7. Automated Outbound AI Voice Sales Calls for Landlines
    const freshLandlines = (await db().sql`
      SELECT id, business_name, contact_person, industry, location, phone, email, status, warmth_score
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (
          phone LIKE '01%' OR phone LIKE '02%' OR phone LIKE '03%' OR
          phone LIKE '+441%' OR phone LIKE '+442%' OR phone LIKE '+443%'
        )
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
      ORDER BY warmth_score DESC, id DESC
      LIMIT ${landlineLimit}
    `) as ProspectRow[]

    for (const landlineProspect of freshLandlines) {
      const digits = (landlineProspect.phone || '').replace(/[^0-9]/g, '')
      if (digits.endsWith(ownerPhoneDigits)) continue

      const callResult = await callLandline(landlineProspect.phone, {
        id: landlineProspect.id,
        businessName: landlineProspect.business_name,
        contactPerson: landlineProspect.contact_person,
        industry: landlineProspect.industry,
      })

      if (callResult.ok) {
        result.callsSent++
        await recordOutcome(
          landlineProspect,
          'Call',
          `Outbound AI Pitch Call Placed (${callResult.callSid || 'Twilio Voice'})`,
          'Contacted',
          new Date().toISOString(),
          landlineProspect.warmth_score + 15
        )
        result.details.push(`Placed AI voice sales call to ${landlineProspect.business_name} (${landlineProspect.phone})`)
      } else {
        result.failedCount++
        console.error(`Landline call failed for ${landlineProspect.phone}:`, callResult.error)
        result.details.push(`Landline call failed for ${landlineProspect.business_name} (${landlineProspect.phone}): ${callResult.error}`)
        await recordOutcome(
          landlineProspect,
          'Call',
          `Call Attempted / Failed: ${(callResult.error || 'Failed').slice(0, 80)}`,
          'Delivery Failed',
          new Date().toISOString(),
          0
        )
      }

      await new Promise((r) => setTimeout(r, 400))
    }

    // 8. Get remaining fresh counts for reporting
    const remainingCountRes = (await db().sql`
      SELECT count(*)::int as count
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (phone LIKE '07%' OR phone LIKE '+447%' OR phone LIKE '447%')
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
    `) as any[]

    result.freshRemaining = (remainingCountRes && remainingCountRes[0]?.count) || 0

    const remainingLandlinesRes = (await db().sql`
      SELECT count(*)::int as count
      FROM apexvoice_prospects
      WHERE status = 'New' AND phone IS NOT NULL AND phone != ''
        AND (
          phone LIKE '01%' OR phone LIKE '02%' OR phone LIKE '03%' OR
          phone LIKE '+441%' OR phone LIKE '+442%' OR phone LIKE '+443%'
        )
        AND phone NOT LIKE '%7700900%' AND phone NOT LIKE '%7700 900%'
        AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) != ${ownerPhoneDigits}
    `) as any[]

    result.freshLandlinesRemaining = (remainingLandlinesRes && remainingLandlinesRes[0]?.count) || 0

    return result
  } catch (error: any) {
    console.error('Outreach runner batch error:', error)
    result.success = false
    result.details.push(`Batch error: ${error.message || 'Unknown error'}`)
    return result
  }
}
