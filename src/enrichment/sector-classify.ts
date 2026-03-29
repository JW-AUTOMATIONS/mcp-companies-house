/**
 * Maps SIC codes to human-readable sector names.
 * Static lookup covers ~95% of UK companies. Ollama enrichment
 * can be layered on top for ambiguous cases in pro tier.
 */

const SIC_SECTOR_MAP: Record<string, string> = {
  // Agriculture, Forestry & Fishing (01-03)
  '01': 'Agriculture',
  '02': 'Forestry',
  '03': 'Fishing & Aquaculture',

  // Mining & Quarrying (05-09)
  '05': 'Mining',
  '06': 'Oil & Gas Extraction',
  '07': 'Metal Ore Mining',
  '08': 'Quarrying',
  '09': 'Mining Support Services',

  // Manufacturing (10-33)
  '10': 'Food Manufacturing',
  '11': 'Beverage Manufacturing',
  '12': 'Tobacco Manufacturing',
  '13': 'Textiles',
  '14': 'Clothing Manufacturing',
  '15': 'Leather & Footwear',
  '16': 'Wood & Cork Products',
  '17': 'Paper Manufacturing',
  '18': 'Printing & Media Reproduction',
  '19': 'Petroleum Products',
  '20': 'Chemical Manufacturing',
  '21': 'Pharmaceutical Manufacturing',
  '22': 'Rubber & Plastics',
  '23': 'Non-Metallic Minerals',
  '24': 'Metal Manufacturing',
  '25': 'Fabricated Metal Products',
  '26': 'Electronics & Computers',
  '27': 'Electrical Equipment',
  '28': 'Machinery & Equipment',
  '29': 'Motor Vehicles',
  '30': 'Transport Equipment',
  '31': 'Furniture Manufacturing',
  '32': 'Other Manufacturing',
  '33': 'Repair & Installation',

  // Utilities (35-39)
  '35': 'Energy & Utilities',
  '36': 'Water Supply',
  '37': 'Sewerage',
  '38': 'Waste Management',
  '39': 'Remediation & Environmental',

  // Construction (41-43)
  '41': 'Construction - Buildings',
  '42': 'Civil Engineering',
  '43': 'Specialist Construction',

  // Wholesale & Retail (45-47)
  '45': 'Motor Vehicle Trade',
  '46': 'Wholesale Trade',
  '47': 'Retail Trade',

  // Transport & Storage (49-53)
  '49': 'Land Transport',
  '50': 'Water Transport',
  '51': 'Air Transport',
  '52': 'Warehousing & Storage',
  '53': 'Postal & Courier',

  // Accommodation & Food (55-56)
  '55': 'Accommodation',
  '56': 'Food & Beverage Services',

  // Information & Communication (58-63)
  '58': 'Publishing',
  '59': 'Film & TV Production',
  '60': 'Broadcasting',
  '61': 'Telecommunications',
  '62': 'Technology & Software',
  '63': 'Information Services',

  // Financial & Insurance (64-66)
  '64': 'Financial Services',
  '65': 'Insurance',
  '66': 'Financial Support Services',

  // Real Estate (68)
  '68': 'Real Estate',

  // Professional, Scientific & Technical (69-75)
  '69': 'Legal & Accounting',
  '70': 'Management Consultancy',
  '71': 'Architecture & Engineering',
  '72': 'Scientific Research',
  '73': 'Advertising & Market Research',
  '74': 'Other Professional Services',
  '75': 'Veterinary Services',

  // Administrative & Support (77-82)
  '77': 'Rental & Leasing',
  '78': 'Recruitment',
  '79': 'Travel & Tourism',
  '80': 'Security & Investigation',
  '81': 'Facilities Management',
  '82': 'Business Support Services',

  // Public Administration (84)
  '84': 'Public Administration & Defence',

  // Education (85)
  '85': 'Education',

  // Health & Social Work (86-88)
  '86': 'Healthcare',
  '87': 'Residential Care',
  '88': 'Social Work',

  // Arts, Entertainment & Recreation (90-93)
  '90': 'Arts & Creative',
  '91': 'Libraries & Museums',
  '92': 'Gambling & Betting',
  '93': 'Sports & Recreation',

  // Other Services (94-96)
  '94': 'Membership Organisations',
  '95': 'Repair Services',
  '96': 'Other Personal Services',

  // Households (97-98)
  '97': 'Household Employers',
  '98': 'Household Goods & Services',

  // Extraterritorial (99)
  '99': 'International Organisations',
};

export function classifySector(sicCodes: string[] | undefined): string {
  if (!sicCodes || sicCodes.length === 0) {
    return 'Unknown';
  }

  // Use the first SIC code as primary sector
  const primary = sicCodes[0];
  const prefix = primary.substring(0, 2);
  return SIC_SECTOR_MAP[prefix] ?? 'Other';
}

export function classifySectors(sicCodes: string[] | undefined): string[] {
  if (!sicCodes || sicCodes.length === 0) {
    return ['Unknown'];
  }

  const sectors = new Set<string>();
  for (const sic of sicCodes) {
    const prefix = sic.substring(0, 2);
    sectors.add(SIC_SECTOR_MAP[prefix] ?? 'Other');
  }
  return [...sectors];
}
