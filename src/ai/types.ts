export interface ExtractionResult {
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  phone: string | null;
  message: string;
  listing_reference: {
    vin?: string;
    stock_number?: string;
    url?: string;
    title?: string;
  } | null;
  source: string | null;
  is_actual_lead: boolean;
  confidence: 'high' | 'medium' | 'low';
}

export interface AIExtractor {
  extract(emailText: string, sourceHint?: string): Promise<ExtractionResult>;
}
