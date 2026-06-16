// ISO 3166-1 alpha-2 country list, used by the admin /admin/origins page
// to give a closed picker instead of free-text fields. Names are in
// English so the picker is searchable in Latin; the admin still types
// the Hebrew name separately. Trimmed to countries plausibly relevant
// for foreign-worker recruitment so the dropdown stays scannable.
//
// If a country isn't in this list, fall back to the existing free-form
// add (the form keeps both paths).

export interface IsoCountry {
  code:    string; // alpha-2, uppercase
  name_en: string;
}

export const ISO_COUNTRIES: readonly IsoCountry[] = [
  { code: 'AL', name_en: 'Albania' },
  { code: 'AM', name_en: 'Armenia' },
  { code: 'AZ', name_en: 'Azerbaijan' },
  { code: 'BA', name_en: 'Bosnia and Herzegovina' },
  { code: 'BD', name_en: 'Bangladesh' },
  { code: 'BG', name_en: 'Bulgaria' },
  { code: 'BR', name_en: 'Brazil' },
  { code: 'BY', name_en: 'Belarus' },
  { code: 'CN', name_en: 'China' },
  { code: 'CO', name_en: 'Colombia' },
  { code: 'CZ', name_en: 'Czechia' },
  { code: 'DO', name_en: 'Dominican Republic' },
  { code: 'EG', name_en: 'Egypt' },
  { code: 'ER', name_en: 'Eritrea' },
  { code: 'ET', name_en: 'Ethiopia' },
  { code: 'FJ', name_en: 'Fiji' },
  { code: 'GE', name_en: 'Georgia' },
  { code: 'GH', name_en: 'Ghana' },
  { code: 'HR', name_en: 'Croatia' },
  { code: 'HU', name_en: 'Hungary' },
  { code: 'ID', name_en: 'Indonesia' },
  { code: 'IN', name_en: 'India' },
  { code: 'IT', name_en: 'Italy' },
  { code: 'JO', name_en: 'Jordan' },
  { code: 'KE', name_en: 'Kenya' },
  { code: 'KG', name_en: 'Kyrgyzstan' },
  { code: 'KH', name_en: 'Cambodia' },
  { code: 'KZ', name_en: 'Kazakhstan' },
  { code: 'LA', name_en: 'Laos' },
  { code: 'LK', name_en: 'Sri Lanka' },
  { code: 'MA', name_en: 'Morocco' },
  { code: 'MD', name_en: 'Moldova' },
  { code: 'ME', name_en: 'Montenegro' },
  { code: 'MK', name_en: 'North Macedonia' },
  { code: 'MM', name_en: 'Myanmar' },
  { code: 'MN', name_en: 'Mongolia' },
  { code: 'MX', name_en: 'Mexico' },
  { code: 'MY', name_en: 'Malaysia' },
  { code: 'NG', name_en: 'Nigeria' },
  { code: 'NP', name_en: 'Nepal' },
  { code: 'PE', name_en: 'Peru' },
  { code: 'PH', name_en: 'Philippines' },
  { code: 'PK', name_en: 'Pakistan' },
  { code: 'PL', name_en: 'Poland' },
  { code: 'PT', name_en: 'Portugal' },
  { code: 'RO', name_en: 'Romania' },
  { code: 'RS', name_en: 'Serbia' },
  { code: 'RU', name_en: 'Russia' },
  { code: 'SD', name_en: 'Sudan' },
  { code: 'SK', name_en: 'Slovakia' },
  { code: 'SN', name_en: 'Senegal' },
  { code: 'TH', name_en: 'Thailand' },
  { code: 'TJ', name_en: 'Tajikistan' },
  { code: 'TM', name_en: 'Turkmenistan' },
  { code: 'TR', name_en: 'Türkiye' },
  { code: 'TZ', name_en: 'Tanzania' },
  { code: 'UA', name_en: 'Ukraine' },
  { code: 'UG', name_en: 'Uganda' },
  { code: 'UZ', name_en: 'Uzbekistan' },
  { code: 'VN', name_en: 'Vietnam' },
  { code: 'ZA', name_en: 'South Africa' },
  { code: 'ZW', name_en: 'Zimbabwe' },
];
