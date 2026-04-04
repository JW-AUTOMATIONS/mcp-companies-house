import { z } from 'zod';

// --- Shared sub-schemas ---

export const AddressSchema = z.object({
  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  care_of: z.string().optional(),
  country: z.string().optional(),
  locality: z.string().optional(),
  po_box: z.string().optional(),
  postal_code: z.string().optional(),
  premises: z.string().optional(),
  region: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;

export const DateOfBirthSchema = z.object({
  month: z.number(),
  year: z.number(),
});

export type DateOfBirth = z.infer<typeof DateOfBirthSchema>;

// --- Company Profile ---

export const AccountingReferenceDateSchema = z.object({
  day: z.union([z.string(), z.number()]).optional(),
  month: z.union([z.string(), z.number()]).optional(),
});

export const LastAccountsSchema = z.object({
  made_up_to: z.string().optional(),
  period_end_on: z.string().optional(),
  period_start_on: z.string().optional(),
  type: z.string().optional(),
});

export const NextAccountsSchema = z.object({
  due_on: z.string().optional(),
  overdue: z.boolean().optional(),
  period_end_on: z.string().optional(),
  period_start_on: z.string().optional(),
});

export const AccountsSchema = z.object({
  accounting_reference_date: AccountingReferenceDateSchema.optional(),
  last_accounts: LastAccountsSchema.optional(),
  next_accounts: NextAccountsSchema.optional(),
  next_due: z.string().optional(),
  next_made_up_to: z.string().optional(),
  overdue: z.boolean().optional(),
});

export const ConfirmationStatementSchema = z.object({
  last_made_up_to: z.string().optional(),
  next_due: z.string().optional(),
  next_made_up_to: z.string().optional(),
  overdue: z.boolean().optional(),
});

export const PreviousCompanyNameSchema = z.object({
  ceased_on: z.string(),
  effective_from: z.string(),
  name: z.string(),
});

export const CompanyProfileLinksSchema = z.object({
  charges: z.string().optional(),
  exemptions: z.string().optional(),
  filing_history: z.string().optional(),
  insolvency: z.string().optional(),
  officers: z.string().optional(),
  overseas: z.string().optional(),
  persons_with_significant_control: z.string().optional(),
  persons_with_significant_control_statements: z.string().optional(),
  registers: z.string().optional(),
  self: z.string(),
  'uk-establishments': z.string().optional(),
});

export const CompanyProfileSchema = z.object({
  accounts: AccountsSchema.optional(),
  annual_return: z.object({
    last_made_up_to: z.string().optional(),
    next_due: z.string().optional(),
    next_made_up_to: z.string().optional(),
    overdue: z.boolean().optional(),
  }).optional(),
  can_file: z.boolean(),
  company_name: z.string(),
  company_number: z.string(),
  company_status: z.string().optional(),
  company_status_detail: z.string().optional(),
  confirmation_statement: ConfirmationStatementSchema.optional(),
  date_of_cessation: z.string().optional(),
  date_of_creation: z.string().optional(),
  etag: z.string().optional(),
  has_been_liquidated: z.boolean().optional(),
  has_charges: z.boolean().optional(),
  has_insolvency_history: z.boolean().optional(),
  is_community_interest_company: z.boolean().optional(),
  jurisdiction: z.string().optional(),
  links: CompanyProfileLinksSchema,
  previous_company_names: z.array(PreviousCompanyNameSchema).optional(),
  registered_office_address: AddressSchema.optional(),
  registered_office_is_in_dispute: z.boolean().optional(),
  sic_codes: z.array(z.string()).optional(),
  subtype: z.string().optional(),
  type: z.string(),
  undeliverable_registered_office_address: z.boolean().optional(),
}).passthrough();

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

// --- Officers ---

export const OfficerIdentificationSchema = z.object({
  identification_type: z.string().optional(),
  legal_authority: z.string().optional(),
  legal_form: z.string().optional(),
  place_registered: z.string().optional(),
  registration_number: z.string().optional(),
});

export const FormerNameSchema = z.object({
  forenames: z.string().optional(),
  surname: z.string().optional(),
});

export const OfficerSchema = z.object({
  address: AddressSchema.optional(),
  appointed_before: z.string().optional(),
  appointed_on: z.string().optional(),
  contact_details: z.object({
    contact_name: z.string().optional(),
  }).optional(),
  country_of_residence: z.string().optional(),
  date_of_birth: DateOfBirthSchema.optional(),
  former_names: z.array(FormerNameSchema).optional(),
  identification: OfficerIdentificationSchema.optional(),
  is_pre_1992_appointment: z.boolean().optional(),
  links: z.object({
    officer: z.object({
      appointments: z.string().optional(),
    }).optional(),
    self: z.string().optional(),
  }),
  name: z.string(),
  nationality: z.string().optional(),
  occupation: z.string().optional(),
  officer_role: z.string(),
  resigned_on: z.string().optional(),
  responsibilities: z.string().optional(),
}).passthrough();

export type Officer = z.infer<typeof OfficerSchema>;

export const OfficerListSchema = z.object({
  active_count: z.number(),
  etag: z.string().optional(),
  items: z.array(OfficerSchema),
  items_per_page: z.number(),
  kind: z.string().optional(),
  links: z.object({
    self: z.string().optional(),
  }).optional(),
  resigned_count: z.number(),
  start_index: z.number(),
  total_results: z.number(),
}).passthrough();

export type OfficerList = z.infer<typeof OfficerListSchema>;

// --- Persons with Significant Control (PSCs) ---

export const PscIdentificationSchema = z.object({
  country_registered: z.string().optional(),
  legal_authority: z.string().optional(),
  legal_form: z.string().optional(),
  place_registered: z.string().optional(),
  registration_number: z.string().optional(),
});

export const PscNameElementsSchema = z.object({
  forename: z.string().optional(),
  middle_name: z.string().optional(),
  surname: z.string().optional(),
  title: z.string().optional(),
});

export const PscSchema = z.object({
  address: AddressSchema.optional(),
  ceased: z.boolean().optional(),
  ceased_on: z.string().optional(),
  country_of_residence: z.string().optional(),
  date_of_birth: DateOfBirthSchema.optional(),
  description: z.string().optional(),
  etag: z.string().optional(),
  identification: PscIdentificationSchema.optional(),
  is_sanctioned: z.boolean().optional(),
  kind: z.string().optional(),
  links: z.object({
    self: z.string().optional(),
    statement: z.string().optional(),
  }).optional(),
  name: z.string(),
  name_elements: PscNameElementsSchema.optional(),
  nationality: z.string().optional(),
  natures_of_control: z.array(z.string()),
  notified_on: z.string(),
}).passthrough();

export type Psc = z.infer<typeof PscSchema>;

export const PscListSchema = z.object({
  active_count: z.number(),
  ceased_count: z.number(),
  items: z.array(PscSchema),
  items_per_page: z.number(),
  links: z.object({
    self: z.string().optional(),
    persons_with_significant_control_list: z.string().optional(),
  }).optional(),
  start_index: z.number(),
  total_results: z.number(),
}).passthrough();

export type PscList = z.infer<typeof PscListSchema>;

// --- Filing History ---

export const FilingAnnotationSchema = z.object({
  annotation: z.string().optional(),
  date: z.string(),
  description: z.string(),
}).passthrough();

export const AssociatedFilingSchema = z.object({
  date: z.string(),
  description: z.string(),
  type: z.string(),
}).passthrough();

export const FilingResolutionSchema = z.object({
  category: z.string(),
  description: z.string(),
  document_id: z.string().optional(),
  receive_date: z.string().optional(),
  subcategory: z.union([z.string(), z.array(z.string())]),
  type: z.string(),
}).passthrough();

export const FilingItemSchema = z.object({
  annotations: z.array(FilingAnnotationSchema).optional(),
  associated_filings: z.array(AssociatedFilingSchema).optional(),
  barcode: z.string().optional(),
  category: z.string(),
  date: z.string(),
  description: z.string(),
  description_values: z.record(z.union([z.string(), z.array(z.unknown()), z.unknown()])).optional(),
  links: z.object({
    document_metadata: z.string().optional(),
    self: z.string().optional(),
  }).optional(),
  pages: z.number().optional(),
  paper_filed: z.boolean().optional(),
  resolutions: z.array(FilingResolutionSchema).optional(),
  subcategory: z.union([z.string(), z.array(z.string())]).optional(),
  transaction_id: z.string(),
  type: z.string(),
}).passthrough();

export type FilingItem = z.infer<typeof FilingItemSchema>;

export const FilingHistoryListSchema = z.object({
  etag: z.string().optional(),
  filing_history_status: z.string().optional(),
  items: z.array(FilingItemSchema),
  items_per_page: z.number(),
  kind: z.string().optional(),
  start_index: z.number(),
  total_count: z.number(),
}).passthrough();

export type FilingHistoryList = z.infer<typeof FilingHistoryListSchema>;

// --- Charges ---

export const ChargeClassificationSchema = z.object({
  description: z.string().optional(),
  type: z.string().optional(),
});

export const ChargeParticularsSchema = z.object({
  chargor_acting_as_bare_trustee: z.boolean().optional(),
  contains_fixed_charge: z.boolean().optional(),
  contains_floating_charge: z.boolean().optional(),
  contains_negative_pledge: z.boolean().optional(),
  description: z.string().optional(),
  floating_charge_covers_all: z.boolean().optional(),
  type: z.string().optional(),
});

export const ChargePersonEntitledSchema = z.object({
  name: z.string(),
});

export const ChargeTransactionSchema = z.object({
  delivered_on: z.string().optional(),
  filing_type: z.string().optional(),
  insolvency_case_number: z.string().optional(),
  links: z.object({
    filing: z.string().optional(),
    insolvency_case: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export const ChargeItemSchema = z.object({
  acquired_on: z.string().optional(),
  assests_ceased_released: z.string().optional(),
  charge_code: z.string().optional(),
  charge_number: z.union([z.number(), z.string()]),
  classification: z.union([ChargeClassificationSchema, z.array(ChargeClassificationSchema)]).optional(),
  covering_instrument_date: z.string().optional(),
  created_on: z.string().optional(),
  delivered_on: z.string().optional(),
  etag: z.string().optional(),
  id: z.string().optional(),
  links: z.object({
    self: z.string().optional(),
  }).optional(),
  more_than_four_persons_entitled: z.boolean().optional(),
  particulars: z.union([ChargeParticularsSchema, z.array(ChargeParticularsSchema)]).optional(),
  persons_entitled: z.array(ChargePersonEntitledSchema).optional(),
  resolved_on: z.string().optional(),
  satisfied_on: z.string().optional(),
  secured_details: z.union([
    z.object({ description: z.string().optional(), type: z.string().optional() }),
    z.array(z.object({ description: z.string().optional(), type: z.string().optional() })),
  ]).optional(),
  status: z.string(),
  transactions: z.array(ChargeTransactionSchema).optional(),
}).passthrough();

export type ChargeItem = z.infer<typeof ChargeItemSchema>;

export const ChargeListSchema = z.object({
  etag: z.string().optional(),
  items: z.array(ChargeItemSchema),
  part_satisfied_count: z.number().optional(),
  satisfied_count: z.number().optional(),
  total_count: z.number().optional(),
  unfiltered_count: z.number().optional(),
}).passthrough();

export type ChargeList = z.infer<typeof ChargeListSchema>;

// --- Insolvency ---

export const InsolvencyPractitionerAddressSchema = z.object({
  address_line_1: z.string().optional(),
  address_line_2: z.string().optional(),
  country: z.string().optional(),
  locality: z.string().optional(),
  postal_code: z.string().optional(),
  region: z.string().optional(),
}).passthrough();

export const InsolvencyPractitionerSchema = z.object({
  address: z.union([InsolvencyPractitionerAddressSchema, z.array(InsolvencyPractitionerAddressSchema)]).optional(),
  appointed_on: z.string().optional(),
  ceased_to_act_on: z.string().optional(),
  name: z.string(),
  role: z.string().optional(),
}).passthrough();

export const InsolvencyCaseDateSchema = z.object({
  date: z.string(),
  type: z.string(),
});

export const InsolvencyCaseSchema = z.object({
  dates: z.array(InsolvencyCaseDateSchema),
  links: z.object({
    charge: z.string().optional(),
  }).optional(),
  notes: z.array(z.string()).optional(),
  number: z.string().optional(),
  practitioners: z.array(InsolvencyPractitionerSchema),
  type: z.string(),
});

export type InsolvencyCase = z.infer<typeof InsolvencyCaseSchema>;

export const CompanyInsolvencySchema = z.object({
  cases: z.array(InsolvencyCaseSchema),
  etag: z.string().optional(),
  status: z.array(z.string()).optional(),
}).passthrough();

export type CompanyInsolvency = z.infer<typeof CompanyInsolvencySchema>;

// --- Company Search ---

export const CompanySearchItemSchema = z.object({
  address: AddressSchema.optional(),
  address_snippet: z.string().optional(),
  company_number: z.string(),
  company_status: z.string().optional(),
  company_type: z.string().optional(),
  date_of_cessation: z.string().optional(),
  date_of_creation: z.string().optional(),
  description: z.string().optional(),
  description_identifier: z.array(z.string()).optional(),
  kind: z.string().optional(),
  links: z.object({
    self: z.string().optional(),
  }).optional(),
  matches: z.object({
    address_snippet: z.array(z.number()).optional(),
    snippet: z.array(z.number()).optional(),
    title: z.array(z.number()).optional(),
  }).optional(),
  snippet: z.string().optional(),
  title: z.string(),
}).passthrough();

export type CompanySearchItem = z.infer<typeof CompanySearchItemSchema>;

export const CompanySearchResultSchema = z.object({
  etag: z.string().optional(),
  items: z.array(CompanySearchItemSchema),
  items_per_page: z.number().optional(),
  kind: z.string().optional(),
  start_index: z.number().optional(),
  total_results: z.number().optional(),
}).passthrough();

export type CompanySearchResult = z.infer<typeof CompanySearchResultSchema>;

// --- Officer Appointments (for director network mapping) ---

export const OfficerAppointmentItemSchema = z.object({
  address: AddressSchema.optional(),
  appointed_before: z.string().optional(),
  appointed_on: z.string().optional(),
  appointed_to: z.object({
    company_name: z.string().optional(),
    company_number: z.string().optional(),
    company_status: z.string().optional(),
  }).optional(),
  country_of_residence: z.string().optional(),
  is_pre_1992_appointment: z.boolean().optional(),
  links: z.object({
    company: z.string().optional(),
  }).optional(),
  name: z.string(),
  name_elements: z.object({
    forename: z.string().optional(),
    honours: z.string().optional(),
    other_forenames: z.string().optional(),
    surname: z.string().optional(),
    title: z.string().optional(),
  }).optional(),
  nationality: z.string().optional(),
  occupation: z.string().optional(),
  officer_role: z.string(),
  resigned_on: z.string().optional(),
}).passthrough();

export type OfficerAppointmentItem = z.infer<typeof OfficerAppointmentItemSchema>;

export const OfficerAppointmentListSchema = z.object({
  date_of_birth: DateOfBirthSchema.optional(),
  etag: z.string().optional(),
  is_corporate_officer: z.boolean().optional(),
  items: z.array(OfficerAppointmentItemSchema),
  items_per_page: z.number(),
  kind: z.string().optional(),
  links: z.object({
    self: z.string().optional(),
  }).optional(),
  name: z.string().optional(),
  start_index: z.number(),
  total_results: z.number(),
}).passthrough();

export type OfficerAppointmentList = z.infer<typeof OfficerAppointmentListSchema>;

// --- Officer Search ---

export const OfficerSearchItemSchema = z.object({
  title: z.string(),
  appointment_count: z.number(),
  description: z.string().optional(),
  address_snippet: z.string().optional(),
  address: AddressSchema.optional(),
  date_of_birth: DateOfBirthSchema.optional(),
  links: z.object({
    self: z.string(),
  }),
}).passthrough();

export type OfficerSearchItem = z.infer<typeof OfficerSearchItemSchema>;

export const OfficerSearchResultSchema = z.object({
  items: z.array(OfficerSearchItemSchema),
  items_per_page: z.number(),
  start_index: z.number(),
  total_results: z.number(),
}).passthrough();

export type OfficerSearchResult = z.infer<typeof OfficerSearchResultSchema>;

// --- Disqualified Officers ---

export const DisqualificationReasonSchema = z.object({
  act: z.string().optional(),
  article: z.string().optional(),
  description_identifier: z.string().optional(),
  section: z.string().optional(),
}).passthrough();

export const DisqualificationSchema = z.object({
  address: AddressSchema.optional(),
  case_identifier: z.string().optional(),
  company_names: z.array(z.string()).optional(),
  court_name: z.string().optional(),
  disqualification_type: z.string().optional(),
  disqualified_from: z.string().optional(),
  disqualified_until: z.string().optional(),
  heard_on: z.string().optional(),
  undertaken_on: z.string().optional(),
  last_variation: z.string().optional(),
  reason: DisqualificationReasonSchema.optional(),
}).passthrough();

export const DisqualifiedOfficerSchema = z.object({
  date_of_birth: z.string().optional(),
  disqualifications: z.array(DisqualificationSchema),
  etag: z.string().optional(),
  forename: z.string().optional(),
  honours: z.string().optional(),
  kind: z.string().optional(),
  links: z.object({ self: z.string().optional() }).optional(),
  nationality: z.string().optional(),
  other_forenames: z.string().optional(),
  person_number: z.string().optional(),
  surname: z.string().optional(),
  title: z.string().optional(),
}).passthrough();

export type DisqualifiedOfficer = z.infer<typeof DisqualifiedOfficerSchema>;

export const DisqualifiedSearchItemSchema = z.object({
  address: AddressSchema.optional(),
  address_snippet: z.string().optional(),
  date_of_birth: z.union([z.string(), DateOfBirthSchema]).optional(),
  description: z.string().optional(),
  description_identifiers: z.array(z.string()).optional(),
  kind: z.string().optional(),
  links: z.object({ self: z.string() }),
  matches: z.object({ snippet: z.array(z.number()).optional() }).optional(),
  snippet: z.string().optional(),
  title: z.string(),
}).passthrough();

export type DisqualifiedSearchItem = z.infer<typeof DisqualifiedSearchItemSchema>;

export const DisqualifiedSearchResultSchema = z.object({
  items: z.array(DisqualifiedSearchItemSchema),
  items_per_page: z.number().optional(),
  kind: z.string().optional(),
  page_number: z.number().optional(),
  start_index: z.number().optional(),
  total_results: z.number().optional(),
}).passthrough();

export type DisqualifiedSearchResult = z.infer<typeof DisqualifiedSearchResultSchema>;
