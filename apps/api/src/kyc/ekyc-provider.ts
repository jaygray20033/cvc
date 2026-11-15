// eKYC provider seam (P2.14, D13). Manual photo review is the shipped flow;
// this interface is kept so an automated eKYC vendor can be plugged in later
// (Backlog) without touching the KYC service. There is intentionally NO
// implementation yet — nothing provides this token at runtime.

// Result a provider returns after checking a document + a selfie against a
// declared identity.
export interface EkycMatchResult {
  /** OCR'd name from the id document, if the provider returns it. */
  documentName?: string;
  /** OCR'd id (CCCD) number, if the provider returns it. */
  documentNumber?: string;
  /** Face similarity between the selfie and the document photo (0..1). */
  faceScore?: number;
  /** Overall automated pass/fail. */
  passed: boolean;
  /** Provider code/message for a failure, for admin display. */
  reason?: string;
}

export interface EkycProvider {
  /** Stable id of the vendor, e.g. "cmcd", "misa-ekyc". */
  readonly name: string;

  /** Whether this provider is configured/enabled in the current environment. */
  isConfigured(): boolean;

  /** Verify one KYC submission automatically. Callers fall back to manual
   *  review when this throws or returns `passed: false`. */
  verify(input: {
    userId: string;
    documentImageUrls: string[];
    selfieImageUrl: string;
    declaredName?: string;
    declaredNumber?: string;
  }): Promise<EkycMatchResult>;
}

// Injection token. A future provider binds it: { provide: EKYC_PROVIDER, useClass: ... }.
export const EKYC_PROVIDER = Symbol('EKYC_PROVIDER');
