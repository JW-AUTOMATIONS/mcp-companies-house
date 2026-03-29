import { InvalidInputError } from './errors.js';

const PREFIXES = ['SC', 'NI', 'OC', 'SO', 'NC', 'NF', 'SF', 'FC', 'GE', 'LP', 'SL', 'NL', 'AC', 'SA', 'NA', 'IP', 'SP', 'IC', 'SI', 'NP', 'NO', 'RC', 'SR', 'NR', 'CE', 'CS', 'PC', 'SE', 'ES'];

export function normalizeCompanyNumber(input: string): string {
  const trimmed = input.trim().toUpperCase();

  // Already valid: 2-letter prefix + 6 digits
  if (/^[A-Z]{2}\d{6}$/.test(trimmed)) {
    return trimmed;
  }

  // Pure digits — pad to 8
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.length > 8) {
      throw new InvalidInputError(
        `Company number "${input}" is too long. Expected up to 8 digits.`,
      );
    }
    return trimmed.padStart(8, '0');
  }

  // Prefix + digits with missing padding (e.g., "SC12345" → "SC012345")
  const prefixMatch = trimmed.match(/^([A-Z]{2})(\d{1,6})$/);
  if (prefixMatch && PREFIXES.includes(prefixMatch[1])) {
    return prefixMatch[1] + prefixMatch[2].padStart(6, '0');
  }

  throw new InvalidInputError(
    `Invalid company number "${input}". Expected 8 digits (e.g., "12345678") or prefix + digits (e.g., "SC123456").`,
  );
}
