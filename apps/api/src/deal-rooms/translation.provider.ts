import { Injectable } from '@nestjs/common';

// P4.14 — adapter seam for P5.22. D11 has not chosen a translation vendor yet,
// so the shipped provider is deterministic and offline (useful in dev/tests).
// P5.22 swaps this binding for a real Claude/translation API implementation;
// the rest of the module only depends on this interface.

export interface TranslationInput {
  text: string;
  targetLang: string;
  sourceLang?: string;
}

export interface TranslationProvider {
  readonly name: string;
  translate(input: TranslationInput): Promise<string>;
}

export const TRANSLATION_PROVIDER = 'TRANSLATION_PROVIDER';

@Injectable()
export class StubTranslationProvider implements TranslationProvider {
  readonly name = 'stub';

  async translate(input: TranslationInput): Promise<string> {
    // Keep the original wording and numbers; the prefix makes the "automatic
    // translation" origin obvious in development and assertions.
    return `[${input.targetLang}] ${input.text}`;
  }
}
