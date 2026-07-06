export interface ModelOption {
  /** Exact model string sent to the API */
  id: string;
  label: string;
  description?: string;
}

export interface ModelCatalog {
  getModelsForProvider: (providerId: string) => ModelOption[];
  getDefaultModelForProvider: (providerId: string) => string;
  hasCuratedModelList: (providerId: string) => boolean;
}
