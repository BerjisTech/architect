export interface ServiceCategory {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly icon?: string | null;
  readonly subcategories: ServiceSubcategory[];
  readonly attributes: CategoryAttribute[];
}

export interface ServiceSubcategory {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly position: number;
  readonly filters?: Record<string, unknown>;
}

export interface CategoryAttribute {
  readonly key: string;
  readonly label: string;
  readonly dataType: AttributeDataType;
  readonly filterConfig: Record<string, unknown>;
  readonly required: boolean;
}

export type AttributeDataType = 'string' | 'enum' | 'multiselect' | 'boolean' | 'number';
