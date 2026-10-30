// Point d'entree du paquet vendorise vendor/pades-libs.min.js.
// Regenere par : npm run vendor-pades (voir scripts/build-vendor-pades.js).
// Expose sur window.TchadiaPadesLibs uniquement ce dont js/pades.js a besoin.
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";
import { SignPdf } from "@signpdf/signpdf";
import { Signer, SignPdfError, SUBFILTER_ETSI_CADES_DETACHED, DEFAULT_BYTE_RANGE_PLACEHOLDER } from "@signpdf/utils";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { Buffer } from "buffer";

globalThis.TchadiaPadesLibs = {
  pkijs,
  asn1js,
  SignPdf,
  Signer,
  SignPdfError,
  pdflibAddPlaceholder,
  Buffer,
  SUBFILTER_ETSI_CADES_DETACHED,
  DEFAULT_BYTE_RANGE_PLACEHOLDER,
};
