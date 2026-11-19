import type { AppointmentInput, ContactInput } from '../types';

// Campaign targets for the MN Rent Assurance & Deposit Protection Act.
// Source: docs/CAMPAIGN_CONTACTS.md (verified 2026-11-17 — house.mn.gov,
// senate.mn member + committee pages, mnhousing.gov, org staff pages).
// Re-check House staff after committees re-form in December.
// People the md lists without a usable channel (Georgia Barnes, Will Freeman,
// Roberto de la Riva, Jessica Szuminski) are folded into notes, not rows.
// Barb Sporlein is NOT current MN Housing staff — do not re-add.
// Megan Ryan was a stale comms guess — replaced by Jill Mazullo.

function contact(
  name: string,
  phone: string | null,
  email: string | null,
  tags: string[],
  notes: string,
): ContactInput {
  return { name, phone, email, tags, plugin_data: { notes } };
}

export const CONTACTS: ContactInput[] = [
  // --- Champions: authors & committee leads ---
  contact(
    'Rep. Esther Agbaje (DFL-59B)',
    '651-296-8659',
    'rep.esther.agbaje@house.mn.gov',
    ['campaign', 'target', 'house', 'chief-author'],
    'Chief author of 2024 tenant act HF3591 (amended §504B.178). Re-elected 87%. First House author ask — LA Aishat Tiamiyu is the working inbox.',
  ),
  contact(
    'Sen. Zaynab Mohamed (DFL-63)',
    '651-296-4274',
    'sen.zaynab.mohamed@mnsenate.gov',
    ['campaign', 'target', 'senate', 'chief-author'],
    'Senate chief author of SF3492 (2024); sits on Housing & Homelessness Prevention. Re-elected 2026. LA Georgia Barnes shares the office line.',
  ),
  contact(
    'Rep. Michael Howard (DFL-51A)',
    '651-296-7158',
    'rep.michael.howard@house.mn.gov',
    ['campaign', 'target', 'house', 'committee-chair'],
    'House housing committee leader; ran bipartisan housing packages. Re-elected 79%. LA Saynab Jama.',
  ),
  contact(
    'Sen. Lindsey Port (DFL-55)',
    '651-296-5975',
    'sen.lindsey.port@mnsenate.gov',
    ['campaign', 'target', 'senate', 'committee-chair'],
    'Chair, Senate Housing & Homelessness Prevention; co-author of 2024 act. Won 62.5%. LA CJ Larson.',
  ),
  contact(
    'Rep. Andrew Myers (R-45A)',
    '651-296-9188',
    'rep.andrew.myers@house.mn.gov',
    ['campaign', 'target', 'house', 'bipartisan'],
    'Assistant Republican Leader; co-authored 2024 tenant act — the GOP cover that kills the "anti-landlord" frame. Meeting request form: house.mn.gov/members/MeetingRequestForm/15618. LA Parker Stromquist.',
  ),
  contact(
    'Rep. Spencer Igo (R-07A)',
    '651-296-4936',
    'rep.spencer.igo@house.mn.gov',
    ['campaign', 'target', 'house', 'bipartisan'],
    'Bipartisan housing record; Howard committee colleague. Won 57%. LA Betsy Ritzer.',
  ),

  // --- Member legislative assistants (the inboxes that actually get read) ---
  contact(
    'Aishat Tiamiyu',
    '651-297-8387',
    'Aishat.Tiamiyu@house.mn.gov',
    ['campaign', 'staff', 'house'],
    'Legislative assistant to Rep. Agbaje — first-stop inbox for the House chief-author ask.',
  ),
  contact(
    'Saynab Jama',
    '651-297-8087',
    'Saynab.Jama@house.mn.gov',
    ['campaign', 'staff', 'house'],
    'Legislative assistant to Rep. Howard (housing committee leader).',
  ),
  contact(
    'Parker Stromquist',
    '651-296-4305',
    'Parker.Stromquist@house.mn.gov',
    ['campaign', 'staff', 'house'],
    'Legislative assistant to Rep. Myers; also listed on his meeting-request form.',
  ),
  contact(
    'Betsy Ritzer',
    '651-296-5489',
    'Betsy.Ritzer@house.mn.gov',
    ['campaign', 'staff', 'house'],
    'Legislative assistant to Rep. Igo.',
  ),
  contact(
    'CJ Larson',
    null,
    'CJ.Larson@mnsenate.gov',
    ['campaign', 'staff', 'senate'],
    'Legislative assistant to Senate Housing Chair Port.',
  ),

  // --- Legislative staff (nonpartisan — they write what members read) ---
  contact(
    'Jack Dudley',
    '651-296-0283',
    'Jack.Dudley@mnsenate.gov',
    ['campaign', 'staff', 'senate'],
    'Administrator, Senate Housing committee — scheduling, member requests, and staff referrals route through him.',
  ),
  contact(
    'Laura Paynter',
    '651-296-5079',
    null,
    ['campaign', 'staff', 'senate', 'analyst'],
    'Nonpartisan analyst, Senate Housing; writes the bill summaries members read.',
  ),
  contact(
    'Erik Olaphson',
    '651-296-0462',
    null,
    ['campaign', 'staff', 'senate', 'fiscal'],
    'Fiscal analyst, Senate Housing — the fiscal-note lens.',
  ),
  contact(
    'Mary Davis',
    '651-296-9253',
    'mary.davis@house.mn.gov',
    ['campaign', 'staff', 'house', 'analyst'],
    'House Research analyst, civil law + housing; wrote the 2024 act summary.',
  ),
  contact(
    'Justin Cope',
    '651-296-7434',
    'justin.cope@house.mn.gov',
    ['campaign', 'staff', 'house', 'analyst'],
    'House Research analyst, taxes + housing.',
  ),
  contact(
    'House Housing committee admins (Brinks/Cousineau)',
    '651-296-5071 / 651-296-4283',
    null,
    ['campaign', 'staff', 'house'],
    'Committee administrators Benji Brinks / Lorie Cousineau — hearing schedules; testimony and handouts due 3pm the day prior, PDF only.',
  ),

  // --- Help writing & front-man candidates ---
  contact(
    'Michael Dahl',
    '612-728-5770 x101',
    'michaeld@homelinemn.org',
    ['campaign', 'coalition', 'front-runner'],
    'HOME Line Public Policy Director, ~30 yrs at the Capitol; won the Tenant Bill of Rights. The drafting/political guide — first call.',
  ),
  contact(
    'Ron Elwood',
    '651-842-6909',
    'relwood@mnlsap.org',
    ['campaign', 'coalition', 'front-runner'],
    'Supervising attorney, Legal Services Advocacy Project (Mid-Minnesota Legal Aid); housing is a core focus; wrote the landlord-tenant session summaries.',
  ),
  contact(
    'Prof. Edward Goetz',
    '612-624-8737',
    'egoetz@umn.edu',
    ['campaign', 'front-runner', 'analyst'],
    'Humphrey School housing scholar, CURA director (retiring 2026 but stays 2 yrs); 2026 Urban Affairs Association award. Credibility anchor for the "why this works" case.',
  ),
  contact(
    'Jennifer Arnold',
    null,
    'Jennifer@inquilinxsunidxs.org',
    ['campaign', 'coalition', 'front-runner'],
    'Exec Director, Inquilinxs Unidxs Por Justicia — grassroots renter organizer (fought rent control); Spanish-speaking community voice. Co-director Roberto de la Riva reachable via the org.',
  ),
  contact(
    'Myah Grimm',
    '612-728-5770 x154',
    'myahg@homelinemn.org',
    ['campaign', 'coalition'],
    'HOME Line Lead Attorney, Policy Strategy.',
  ),

  // --- Coalition (org rows; secondary people carried in notes) ---
  contact(
    'HOME Line',
    '612-728-5770',
    'erich@homelinemn.org',
    ['campaign', 'coalition'],
    'Tenant hotline/advocacy org; 20k+ renter contacts/yr; endorsement near-mandatory for a tenant bill. Co-EDs Eric Hauge (erich@, this inbox) / Jess Zarik jessz@homelinemn.org. Dahl + Grimm are separate contacts.',
  ),
  contact(
    'Minnesota Housing Partnership',
    '651-925-5550',
    'elizabeth.glidden@mhponline.org',
    ['campaign', 'coalition'],
    'Statewide housing coalition; carries funding asks. Deputy ED Elizabeth Glidden runs policy (this inbox); Policy Manager Courtney Schaff courtney.schaff@mhponline.org — ex-Senate Housing staff.',
  ),
  contact(
    'Housing Justice Center',
    '612-807-1139',
    'info@hjcmn.org',
    ['campaign', 'coalition'],
    'Coalition advocacy, TOPA network. Co-EDs Shana Tomenes stomenes@hjcmn.org / Anne Smetak asmetak@hjcmn.org; Policy Attorney Jessica Szuminski via info@.',
  ),

  // --- Agencies ---
  contact(
    'Rachel Franco',
    '651-296-2172',
    'rachel.franco@state.mn.us',
    ['campaign', 'agency', 'mnhousing'],
    'Exec Asst to MHFA Commissioner Jennifer Ho — the gate to the commissioner; pilot asks route through her.',
  ),
  contact(
    'Ryan Baumtrog',
    '651-296-9820',
    'ryan.baumtrog@state.mn.us',
    ['campaign', 'agency', 'mnhousing'],
    'Deputy Commissioner, Policy & Community Development — THE deposit-assistance/guarantee pilot contact.',
  ),
  contact(
    'Joel Salzer',
    null,
    'joel.salzer@state.mn.us',
    ['campaign', 'agency', 'mnhousing'],
    'Asst Commissioner, Housing Stability Division — runs FHPAP/homelessness programs; deposit assistance already funded there.',
  ),
  contact(
    'Jill Mazullo',
    null,
    'jill.mazullo@state.mn.us',
    ['campaign', 'agency', 'mnhousing'],
    'Communications Director, MN Housing — press/announcement lane for the pilot.',
  ),
  contact(
    'Jonathan Moler',
    null,
    'jonathan.moler@state.mn.us',
    ['campaign', 'agency', 'mnhousing'],
    'General Counsel, MN Housing.',
  ),
  contact(
    'Jennifer Ho',
    null,
    null,
    ['campaign', 'agency', 'mnhousing'],
    'Commissioner, Minnesota Housing (MHFA). No direct channel — reached via Rachel Franco. Pilot path: deposit assistance/guarantee pilot → commissioner meeting → board item, or a line in the Jan 26 governor budget. General inbox: mn.housing@state.mn.us · 651-296-7608.',
  ),
  contact(
    'MN Dept of Commerce (Insurance)',
    '651-539-1500',
    null,
    ['campaign', 'agency'],
    'Insurance division licenses surety products; commerce.state.mn.us. Two uses: informal review of what regulatory treatment the public pool needs, and scrutiny of private deposit products (Rhino/LeaseLock marketing in MN).',
  ),
  contact(
    'MN Attorney General',
    '651-296-3353 / 800-657-3787',
    null,
    ['campaign', 'agency'],
    'Consumer protection; ag.state.mn.us. Tenant Report Form; already suing on deposit abuse — the LeaseLock lever exists here without any new law (MD AG forced refunds statewide, 2022).',
  ),

  // --- Governor-elect ---
  contact(
    'Governor-elect Amy Klobuchar transition team',
    '651-539-3150',
    'info@govklobuchar.com',
    ['campaign', 'target', 'executive'],
    "Transition team (Chair: Cindy Jesson); sworn in Jan 4 2027. Housing plan includes 'support renters... simplifying access to assistance for paying rent' and 100k homes. Governor's budget due Jan 26 — ask for the housing policy contact; scheduling-request form on govklobuchar.com.",
  ),

  // --- Opposition watch ---
  contact(
    'MN Multi Housing Association',
    '952-548-2208',
    'cecil.smith@mmha.com',
    ['campaign', 'opposition-watch'],
    'Landlord lobby; learn the position early — expect opposition at hearings. President & CEO Cecil Smith (this inbox) 952-548-2208; VP Gov Affairs Todd Liljenquist todd.liljenquist@mmha.com 952-548-2204; Dir. Gov Affairs Marty McDonough marty.mcdonough@mmha.com 952-548-2217.',
  ),
];

// Milestones are America/Chicago wall clock, 60 minutes each.
// CST = UTC-6 (Nov–mid Mar), CDT = UTC-5 (mid Mar–Nov).
const HOUR_MS = 60 * 60 * 1000;

function appt(
  title: string,
  chicagoLocal: string,
  offset: '-06:00' | '-05:00',
): AppointmentInput {
  const starts = new Date(`${chicagoLocal.replace(' ', 'T')}:00${offset}`);
  return {
    title,
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + HOUR_MS).toISOString(),
    status: 'scheduled',
  };
}

export const APPOINTMENTS: AppointmentInput[] = [
  appt(
    'Outreach: request briefings with Agbaje/Mohamed/Howard/Port offices',
    '2026-11-23 09:00',
    '-06:00',
  ),
  appt('Brief committee staff (Dudley, Paynter, Olaphson)', '2026-12-01 09:00', '-06:00'),
  appt('Pitch HOME Line + MHP for endorsement', '2026-12-08 09:00', '-06:00'),
  appt('MHFA pilot concept paper to Commissioner Ho', '2026-12-15 09:00', '-06:00'),
  appt('Session convenes — bill introduction day', '2027-01-12 09:00', '-06:00'),
  appt("Governor's budget due — housing line check", '2027-01-26 09:00', '-06:00'),
  appt('Committee deadlines (approx.) — omnibus inclusion push', '2027-04-02 09:00', '-05:00'),
];
