import { describe, it, expect } from 'vitest';
import {
  CompanyProfileSchema,
  OfficerListSchema,
  PscListSchema,
  FilingHistoryListSchema,
  ChargeListSchema,
  CompanyInsolvencySchema,
  CompanySearchResultSchema,
  OfficerAppointmentListSchema,
} from '../../src/api/types.js';

describe('CompanyProfileSchema', () => {
  it('parses a minimal company profile', () => {
    const result = CompanyProfileSchema.safeParse({
      can_file: true,
      company_name: 'TEST LTD',
      company_number: '12345678',
      links: { self: '/company/12345678' },
      type: 'ltd',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.company_name).toBe('TEST LTD');
      expect(result.data.company_number).toBe('12345678');
    }
  });

  it('parses a full company profile with nested objects', () => {
    const result = CompanyProfileSchema.safeParse({
      can_file: true,
      company_name: 'ACME WIDGETS PLC',
      company_number: '00987654',
      company_status: 'active',
      date_of_creation: '2010-01-15',
      links: {
        self: '/company/00987654',
        filing_history: '/company/00987654/filing-history',
        officers: '/company/00987654/officers',
        persons_with_significant_control: '/company/00987654/persons-with-significant-control',
        charges: '/company/00987654/charges',
      },
      type: 'plc',
      sic_codes: ['62020', '62090'],
      registered_office_address: {
        address_line_1: '123 High Street',
        locality: 'London',
        postal_code: 'EC1A 1BB',
        country: 'England',
      },
      accounts: {
        accounting_reference_date: { day: 31, month: 12 },
        last_accounts: { period_end_on: '2024-12-31', type: 'full' },
        next_accounts: { due_on: '2025-09-30', overdue: false },
      },
      confirmation_statement: {
        last_made_up_to: '2025-01-15',
        next_due: '2026-01-29',
        next_made_up_to: '2026-01-15',
        overdue: false,
      },
      previous_company_names: [
        { ceased_on: '2015-06-01', effective_from: '2010-01-15', name: 'OLD NAME LTD' },
      ],
      has_charges: true,
      has_insolvency_history: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sic_codes).toEqual(['62020', '62090']);
      expect(result.data.registered_office_address?.postal_code).toBe('EC1A 1BB');
      expect(result.data.accounts?.next_accounts?.overdue).toBe(false);
      expect(result.data.previous_company_names).toHaveLength(1);
    }
  });

  it('allows unknown fields via passthrough', () => {
    const result = CompanyProfileSchema.safeParse({
      can_file: true,
      company_name: 'TEST LTD',
      company_number: '12345678',
      links: { self: '/company/12345678' },
      type: 'ltd',
      some_new_api_field: 'unexpected',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = CompanyProfileSchema.safeParse({
      company_name: 'TEST LTD',
    });
    expect(result.success).toBe(false);
  });
});

describe('OfficerListSchema', () => {
  it('parses an officer list', () => {
    const result = OfficerListSchema.safeParse({
      active_count: 2,
      items: [
        {
          name: 'SMITH, John',
          officer_role: 'director',
          appointed_on: '2020-01-01',
          links: { self: '/officers/abc123' },
          address: { address_line_1: '1 Test Road', postal_code: 'AB1 2CD' },
          date_of_birth: { month: 3, year: 1985 },
        },
        {
          name: 'DOE, Jane',
          officer_role: 'secretary',
          appointed_on: '2021-06-15',
          resigned_on: '2023-12-01',
          links: { self: '/officers/def456' },
        },
      ],
      items_per_page: 35,
      resigned_count: 1,
      start_index: 0,
      total_results: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].date_of_birth?.year).toBe(1985);
      expect(result.data.items[1].resigned_on).toBe('2023-12-01');
    }
  });
});

describe('PscListSchema', () => {
  it('parses an individual PSC', () => {
    const result = PscListSchema.safeParse({
      active_count: 1,
      ceased_count: 0,
      items: [
        {
          name: 'Mr John Smith',
          natures_of_control: [
            'ownership-of-shares-75-to-100-percent',
            'voting-rights-75-to-100-percent',
          ],
          notified_on: '2016-04-06',
          kind: 'individual-person-with-significant-control',
          name_elements: { forename: 'John', surname: 'Smith', title: 'Mr' },
          nationality: 'British',
          country_of_residence: 'England',
        },
      ],
      items_per_page: 25,
      start_index: 0,
      total_results: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].natures_of_control).toHaveLength(2);
      expect(result.data.items[0].kind).toContain('individual');
    }
  });

  it('parses a corporate PSC', () => {
    const result = PscListSchema.safeParse({
      active_count: 1,
      ceased_count: 0,
      items: [
        {
          name: 'HOLDING CO LTD',
          natures_of_control: ['ownership-of-shares-75-to-100-percent'],
          notified_on: '2016-04-06',
          kind: 'corporate-entity-person-with-significant-control',
          identification: {
            legal_authority: 'Companies Act 2006',
            legal_form: 'Limited',
            place_registered: 'England And Wales',
            registration_number: '99999999',
          },
        },
      ],
      items_per_page: 25,
      start_index: 0,
      total_results: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].identification?.registration_number).toBe('99999999');
    }
  });
});

describe('FilingHistoryListSchema', () => {
  it('parses filing history', () => {
    const result = FilingHistoryListSchema.safeParse({
      items: [
        {
          category: 'accounts',
          date: '2025-09-15',
          description: 'accounts-with-accounts-type-full',
          transaction_id: 'MzM5NTk4NzEwMWFkaXF6a2N4',
          type: 'AA',
        },
        {
          category: 'confirmation-statement',
          date: '2025-01-20',
          description: 'confirmation-statement',
          transaction_id: 'MzM5NTk4NzEwMmFkaXF6a2N4',
          type: 'CS01',
        },
      ],
      items_per_page: 25,
      start_index: 0,
      total_count: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].category).toBe('accounts');
    }
  });
});

describe('ChargeListSchema', () => {
  it('parses a charge list', () => {
    const result = ChargeListSchema.safeParse({
      items: [
        {
          charge_number: 1,
          id: 'abc123',
          status: 'outstanding',
          created_on: '2020-03-01',
          delivered_on: '2020-03-10',
          persons_entitled: [{ name: 'BIG BANK PLC' }],
          particulars: [
            {
              description: 'All assets',
              type: 'short-particulars',
              contains_floating_charge: true,
              floating_charge_covers_all: true,
            },
          ],
          classification: [{ description: 'A registered charge', type: 'charge-description' }],
        },
      ],
      total_count: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].status).toBe('outstanding');
      expect(result.data.items[0].persons_entitled?.[0].name).toBe('BIG BANK PLC');
    }
  });
});

describe('CompanyInsolvencySchema', () => {
  it('parses insolvency data', () => {
    const result = CompanyInsolvencySchema.safeParse({
      cases: [
        {
          type: 'creditors-voluntary-liquidation',
          dates: [
            { date: '2024-06-01', type: 'wound-up-on' },
          ],
          practitioners: [
            {
              name: 'Mr Insolvency Practitioner',
              role: 'practitioner',
              appointed_on: '2024-06-01',
              address: [{ address_line_1: '1 Legal Lane', postal_code: 'WC1A 1AA' }],
            },
          ],
          number: '1',
        },
      ],
      status: ['liquidation'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cases[0].type).toBe('creditors-voluntary-liquidation');
      expect(result.data.cases[0].practitioners[0].name).toBe('Mr Insolvency Practitioner');
    }
  });
});

describe('CompanySearchResultSchema', () => {
  it('parses search results', () => {
    const result = CompanySearchResultSchema.safeParse({
      items: [
        {
          company_number: '12345678',
          title: 'TEST COMPANY LTD',
          company_status: 'active',
          company_type: 'ltd',
          date_of_creation: '2020-01-01',
          address_snippet: '123 High St, London, EC1A 1BB',
          address: { address_line_1: '123 High St', locality: 'London', postal_code: 'EC1A 1BB' },
          kind: 'searchresults#company',
          description: 'active - Incorporated on 1 January 2020',
        },
      ],
      total_results: 1,
      items_per_page: 20,
      start_index: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].company_number).toBe('12345678');
      expect(result.data.total_results).toBe(1);
    }
  });
});

describe('OfficerAppointmentListSchema', () => {
  it('parses officer appointments', () => {
    const result = OfficerAppointmentListSchema.safeParse({
      items: [
        {
          name: 'SMITH, John',
          officer_role: 'director',
          appointed_on: '2020-01-01',
          appointed_to: {
            company_name: 'TEST LTD',
            company_number: '12345678',
            company_status: 'active',
          },
        },
        {
          name: 'SMITH, John',
          officer_role: 'director',
          appointed_on: '2018-06-01',
          resigned_on: '2022-03-15',
          appointed_to: {
            company_name: 'OLD COMPANY LTD',
            company_number: '87654321',
            company_status: 'dissolved',
          },
        },
      ],
      items_per_page: 35,
      start_index: 0,
      total_results: 2,
      name: 'John SMITH',
      date_of_birth: { month: 3, year: 1985 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].appointed_to?.company_number).toBe('12345678');
      expect(result.data.name).toBe('John SMITH');
    }
  });
});
