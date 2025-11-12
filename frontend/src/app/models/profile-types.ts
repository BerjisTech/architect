export type ArchitectProfileType =
  | 'homeowner'
  | 'architect'
  | 'quantity_surveyor'
  | 'land_surveyor'
  | 'lawyer'
  | 'material_supplier'
  | 'contractor'
  | 'handyman'
  | 'interior_designer'
  | 'mover';

export interface ProviderProfileDefinition {
  readonly type: ArchitectProfileType;
  readonly label: string;
  readonly description: string;
  readonly role: string;
}

export const ARCHITECT_PROVIDER_ROLE_BASE = 'architect.provider';

export const ARCHITECT_PROVIDER_PROFILES: ProviderProfileDefinition[] = [
  {
    type: 'homeowner',
    label: 'Homeowner',
    description: 'Property owners managing their own construction projects.',
    role: 'architect.homeowner'
  },
  {
    type: 'architect',
    label: 'Architect / Consultant',
    description: 'Licensed architects and design consultants offering concept-to-permit services.',
    role: 'architect.architect'
  },
  {
    type: 'quantity_surveyor',
    label: 'Quantity Surveyor',
    description: 'Cost estimators delivering BOQs, value engineering, and budget oversight.',
    role: 'architect.quantity_surveyor'
  },
  {
    type: 'land_surveyor',
    label: 'Land Surveyor',
    description: 'Surveyors providing boundary, topographical, and geospatial assessments.',
    role: 'architect.land_surveyor'
  },
  {
    type: 'lawyer',
    label: 'Construction Lawyer',
    description: 'Legal specialists handling contracts, compliance, and dispute resolution.',
    role: 'architect.lawyer'
  },
  {
    type: 'material_supplier',
    label: 'Material Supplier',
    description: 'Vendors supplying construction materials, finishes, and fixtures.',
    role: 'architect.material_supplier'
  },
  {
    type: 'contractor',
    label: 'Contractor',
    description: 'General contractors or specialty trades executing construction projects.',
    role: 'architect.contractor'
  },
  {
    type: 'handyman',
    label: 'Handyman / Maintenance',
    description: 'Small job specialists for maintenance, repairs, and minor renovations.',
    role: 'architect.handyman'
  },
  {
    type: 'interior_designer',
    label: 'Interior Designer',
    description: 'Interior designers and stylists delivering FF&E selections and staging.',
    role: 'architect.interior_designer'
  },
  {
    type: 'mover',
    label: 'Moving & Logistics',
    description: 'Relocation and installation logistics providers.',
    role: 'architect.mover'
  }
];

export const ARCHITECT_PROVIDER_TYPES: readonly ArchitectProfileType[] =
  ARCHITECT_PROVIDER_PROFILES.map((profile) => profile.type) as const;

export const ARCHITECT_PROVIDER_ROLE_BY_TYPE = new Map<ArchitectProfileType, string>(
  ARCHITECT_PROVIDER_PROFILES.map((profile) => [profile.type, profile.role])
);

export function getProviderProfile(type: ArchitectProfileType): ProviderProfileDefinition | undefined {
  return ARCHITECT_PROVIDER_PROFILES.find((profile) => profile.type === type);
}
