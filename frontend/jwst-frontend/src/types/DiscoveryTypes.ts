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
  wavelengthUm?: number;
  observationId?: string;
}

/** A composite recipe suggestion from the recipe engine */
export interface CompositeRecipe {
  name: string;
  rank: number;
  filters: string[];
  colorMapping?: Record<string, string>;
  instruments: string[];
  requiresMosaic: boolean;
  estimatedTimeSeconds: number;
  observationIds?: string[];
}

/** Target metadata returned with recipe suggestions */
export interface TargetInfo {
  name?: string;
  commonName?: string;
  ra?: number;
  dec?: number;
  category?: string;
}

/** Request body for POST /api/discovery/suggest-recipes */
export interface SuggestRecipesRequest {
  targetName?: string;
  observations: ObservationInput[];
}

/** Response from POST /api/discovery/suggest-recipes */
export interface SuggestRecipesResponse {
  target?: TargetInfo;
  recipes: CompositeRecipe[];
}
