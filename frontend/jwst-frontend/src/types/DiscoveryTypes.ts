/** Featured target from the /api/discovery/featured endpoint */
export interface FeaturedTarget {
  name: string;
  catalogId?: string;
  category: string;
  description: string;
  thumbnail?: string;
  instruments: string[];
  filterCount: number;
  compositePotential: 'great' | 'good' | 'limited';
  mastSearchParams: {
    target: string;
    instrument?: string;
  };
}

/** Response from GET /api/discovery/featured */
export type FeaturedTargetsResponse = FeaturedTarget[];

/** A single observation input for the recipe engine */
export interface ObservationInput {
  filter: string;
  instrument: string;
  wavelength_um?: number;
  observation_id?: string;
}

/** A composite recipe suggestion from the recipe engine */
export interface CompositeRecipe {
  name: string;
  rank: number;
  filters: string[];
  color_mapping: Record<string, string>;
  instruments: string[];
  requires_mosaic: boolean;
  estimated_time_seconds: number;
  observation_ids?: string[];
}

/** Target metadata returned with recipe suggestions */
export interface TargetInfo {
  name?: string;
  common_name?: string;
  ra?: number;
  dec?: number;
  category?: string;
}

/** Request body for POST /api/discovery/suggest-recipes */
export interface SuggestRecipesRequest {
  target_name?: string;
  observations: ObservationInput[];
}

/** Response from POST /api/discovery/suggest-recipes */
export interface SuggestRecipesResponse {
  target?: TargetInfo;
  recipes: CompositeRecipe[];
}
