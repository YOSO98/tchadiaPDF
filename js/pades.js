/* tchadiaPdf : signature numérique PAdES (certificat .p12 / .pfx local)
 *
 * Tout se passe dans le navigateur : le certificat, son mot de passe et le
 * PDF ne quittent jamais l'onglet. Les bibliothèques (pkijs, asn1js,
 * @signpdf) sont servies depuis notre propre domaine (vendor/), chargées à
 * la demande avec contrôle d'intégrité SRI, et la cryptographie passe par
 * WebCrypto (crypto.subtle).
 *
 * Profil produit : PAdES de base (niveau B-B, ETSI EN 319 142-1) :
 *   /Filter /Adobe.PPKLite, /SubFilter /ETSI.CAdES.detached,
 *   CMS SignedData détaché, SHA-256, attributs signés content-type,
 *   message-digest et signing-certificate-v2, sans attribut signing-time
 *   (l'heure de signature est portée par /M dans le dictionnaire).
 *
 * API exposée : window.TchadiaPades
 *   chargerBibliotheques()            -> Promise<libs>
 *   lireCertificatP12(octets, mdp)    -> Promise<identite>
 *   signerPdf(pdfDoc, identite, opts) -> Promise<Uint8Array>
 *   messageErreur(e)                  -> texte français pour l'utilisateur
 */
(function () {
  "use strict";

  // URL et empreinte SRI mises à jour automatiquement par
  // scripts/build-vendor-pades.js (npm run vendor-pades).
  const PADES_LIBS_URL = "/vendor/pades-libs.min.js?v=d07d2c06";
  const PADES_LIBS_SRI = "sha384-DN4KOpUJHcec7wYxjWMHH5QgxBjubHDYGYtssIQPaYBhvaiJQlEc2P3Kbopl5GRa";

  const OID = {
    data: "1.2.840.113549.1.7.1",
    contentType: "1.2.840.113549.1.9.3",
    messageDigest: "1.2.840.113549.1.9.4",
    signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
    localKeyId: "1.2.840.113549.1.9.21",
    keyBag: "1.2.840.113549.1.12.10.1.1",
    shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
    certBag: "1.2.840.113549.1.12.10.1.3",
    rsa: "1.2.840.113549.1.1.1",
    ecPublicKey: "1.2.840.10045.2.1",
    p256: "1.2.840.10045.3.1.7",
    p384: "1.3.132.0.34",
    p521: "1.3.132.0.35",
    commonName: "2.5.4.3",
    organisation: "2.5.4.10",
  };

  // Taille réservée dans /Contents (octets de CMS, doublés en hexadécimal) :
  // large pour accepter une chaîne de plusieurs certificats RSA 4096.
  const TAILLE_SIGNATURE = 16384;

  class ErreurPades extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  /* ---------- Chargement paresseux des bibliothèques ---------- */

  let promesseLibs = null;

  function chargerBibliotheques() {
    if (window.TchadiaPadesLibs) return Promise.resolve(window.TchadiaPadesLibs);
    if (promesseLibs) return promesseLibs;
    promesseLibs = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PADES_LIBS_URL;
      s.integrity = PADES_LIBS_SRI;
      s.crossOrigin = "anonymous";
      s.onload = () => {
        if (window.TchadiaPadesLibs) resolve(window.TchadiaPadesLibs);
        else reject(new ErreurPades("chargement", "Les bibliothèques de signature n'ont pas pu être initialisées."));
      };
      s.onerror = () => {
        promesseLibs = null;
        reject(new ErreurPades("chargement", "Les bibliothèques de signature n'ont pas pu être chargées. Vérifiez votre connexion puis réessayez."));
      };
      document.head.appendChild(s);
    });
    return promesseLibs;
  }

  /* ---------- Utilitaires ---------- */

  function versArrayBuffer(octets) {
    if (octets instanceof ArrayBuffer) return octets;
    return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength);
  }

  function egaux(a, b) {
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }

  /** Lit un attribut (CN, O...) d'un nom X.509 pkijs. */
  function attributNom(nom, oid) {
    const tv = nom.typesAndValues.find((t) => t.type === oid);
    return tv ? String(tv.value.valueBlock.value) : "";
  }

  function libelleNom(nom) {
    return attributNom(nom, OID.commonName) || attributNom(nom, OID.organisation) || "(sans nom)";
  }

  /** Valeur de l'attribut localKeyId d'un sac PKCS#12, ou null. */
  function localKeyId(bag) {
    const attr = (bag.bagAttributes || []).find((a) => a.type === OID.localKeyId);
    return attr && attr.values[0] ? attr.values[0].valueBlock.valueHexView : null;
  }

  /* ---------- Lecture du certificat PKCS#12 ---------- */

  /**
   * Ouvre un fichier .p12/.pfx avec son mot de passe et renvoie la clé
   * privée (CryptoKey non exportable), le certificat du signataire et la
   * chaîne de certificats présente dans le fichier.
   */
  async function lireCertificatP12(octets, motDePasse) {
    const { pkijs, asn1js } = await chargerBibliotheques();
    const mdp = new TextEncoder().encode(motDePasse || "").buffer;

    let pfx;
    try {
      const asn = asn1js.fromBER(versArrayBuffer(octets));
      if (asn.offset === -1) throw new Error("ASN.1");
      pfx = new pkijs.PFX({ schema: asn.result });
    } catch (e) {
      throw new ErreurPades("format", "Ce fichier n'est pas un certificat PKCS#12 valide (.p12 ou .pfx).");
    }

    try {
      await pfx.parseInternalValues({ password: mdp, checkIntegrity: true });
    } catch (e) {
      throw classerErreurDechiffrement(e);
    }
    const safe = pfx.parsedValue && pfx.parsedValue.authenticatedSafe;
    if (!safe) throw new ErreurPades("format", "Ce certificat PKCS#12 ne contient aucune donnée exploitable.");

    try {
      await safe.parseInternalValues({ safeContents: safe.safeContents.map(() => ({ password: mdp })) });
    } catch (e) {
      throw classerErreurDechiffrement(e);
    }

    const cles = [];
    const certs = [];
    for (const contenu of safe.parsedValue.safeContents) {
      for (const bag of contenu.value.safeBags) {
        if (bag.bagId === OID.shroudedKeyBag) {
          try {
            await bag.bagValue.parseInternalValues({ password: mdp });
          } catch (e) {
            throw classerErreurDechiffrement(e);
          }
          cles.push({ info: bag.bagValue.parsedValue, id: localKeyId(bag) });
        } else if (bag.bagId === OID.keyBag) {
          cles.push({ info: bag.bagValue, id: localKeyId(bag) });
        } else if (bag.bagId === OID.certBag && bag.bagValue.parsedValue instanceof pkijs.Certificate) {
          certs.push({ cert: bag.bagValue.parsedValue, id: localKeyId(bag) });
        }
      }
    }

    if (cles.length === 0) throw new ErreurPades("sans-cle", "Ce fichier ne contient pas de clé privée : impossible de signer avec. Exportez le certificat AVEC sa clé privée.");
    if (certs.length === 0) throw new ErreurPades("sans-certificat", "Ce fichier ne contient aucun certificat.");

    const cle = cles[0];
    // Certificat du signataire : celui qui partage le localKeyId de la clé,
    // sinon le certificat « feuille » (qui n'a émis aucun autre certificat).
    let signataire = cle.id ? certs.find((c) => c.id && egaux(c.id, cle.id)) : null;
    if (!signataire) {
      signataire = certs.find((c) => !certs.some((autre) => autre !== c && autre.cert.issuer.isEqual(c.cert.subject))) || certs[0];
    }

    const privateKey = await importerCle(cle.info);
    const cert = signataire.cert;

    return {
      privateKey,
      certificat: cert,
      chaine: certs.map((c) => c.cert).filter((c) => c !== cert),
      titulaire: libelleNom(cert.subject),
      emetteur: libelleNom(cert.issuer),
      autoSigne: cert.issuer.isEqual(cert.subject),
      valideDu: cert.notBefore.value,
      valideAu: cert.notAfter.value,
      algorithme: privateKey.algorithm.name === "ECDSA" ? "ECDSA " + privateKey.algorithm.namedCurve : "RSA " + (privateKey.algorithm.modulusLength || ""),
    };
  }

  function classerErreurDechiffrement(e) {
    const texte = String((e && e.message) || e);
    // pkijs : « Unknown "contentEncryptionAlgorithm": 1.2.840.113549.1.12.1.x »
    // pour les algorithmes PKCS#12 historiques (pbeWithSHAAnd3-KeyTripleDES, RC2...).
    if (/1\.2\.840\.113549\.1\.12\.1\.|Unknown|unsupported|not supported/i.test(texte)) {
      return new ErreurPades(
        "algorithme-ancien",
        "Ce certificat est protégé par un ancien chiffrement (3DES ou RC2) que les navigateurs ne savent plus déchiffrer. " +
        "Réexportez-le en AES-256 (Windows : option « AES256-SHA256 » ; OpenSSL : openssl pkcs12 -export sans -legacy) puis réessayez."
      );
    }
    return new ErreurPades("mot-de-passe", "Mot de passe du certificat incorrect, ou fichier .p12 endommagé.");
  }

  async function importerCle(privateKeyInfo) {
    const der = privateKeyInfo.toSchema().toBER(false);
    const algo = privateKeyInfo.privateKeyAlgorithm;
    let params;
    if (algo.algorithmId === OID.rsa) {
      params = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    } else if (algo.algorithmId === OID.ecPublicKey) {
      const courbe = algo.algorithmParams && algo.algorithmParams.valueBlock ? algo.algorithmParams.valueBlock.toString() : "";
      const nomCourbe = { [OID.p256]: "P-256", [OID.p384]: "P-384", [OID.p521]: "P-521" }[courbe];
      if (!nomCourbe) throw new ErreurPades("algorithme-cle", "Courbe elliptique non prise en charge (seules P-256, P-384 et P-521 le sont).");
      params = { name: "ECDSA", namedCurve: nomCourbe };
    } else {
      throw new ErreurPades("algorithme-cle", "Type de clé non pris en charge (seules les clés RSA et ECDSA le sont).");
    }
    try {
      return await crypto.subtle.importKey("pkcs8", der, params, false, ["sign"]);
    } catch (e) {
      throw new ErreurPades("algorithme-cle", "La clé privée de ce certificat n'a pas pu être importée par le navigateur.");
    }
  }

  /* ---------- Construction de la signature CMS (CAdES détachée) ---------- */

  async function construireCms(libs, identite, donnees) {
    const { pkijs, asn1js } = libs;
    const cert = identite.certificat;
    const empreinte = await crypto.subtle.digest("SHA-256", donnees);
    const empreinteCert = await crypto.subtle.digest("SHA-256", cert.toSchema().toBER(false));

    // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
    // ESSCertIDv2 ::= SEQUENCE { certHash OCTET STRING, issuerSerial }
    // (hashAlgorithm omis : SHA-256 est la valeur par défaut).
    const issuerSerial = new asn1js.Sequence({
      value: [
        new asn1js.Sequence({
          value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })],
        }),
        new asn1js.Integer({ valueHex: cert.serialNumber.valueBlock.valueHexView }),
      ],
    });
    const signingCertificateV2 = new asn1js.Sequence({
      value: [new asn1js.Sequence({
        value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: empreinteCert }), issuerSerial] })],
      })],
    });

    const signedData = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
              new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: empreinte })] }),
              new pkijs.Attribute({ type: OID.signingCertificateV2, values: [signingCertificateV2] }),
            ],
          }),
        }),
      ],
      certificates: [cert].concat(identite.chaine),
    });

    await signedData.sign(identite.privateKey, 0, "SHA-256");

    const contentInfo = new pkijs.ContentInfo({
      contentType: pkijs.ContentInfo.SIGNED_DATA,
      content: signedData.toSchema(true),
    });
    return new Uint8Array(contentInfo.toSchema().toBER(false));
  }

  /* ---------- Signature du PDF ---------- */

  /**
   * pdflibAddPlaceholder suppose que /Fields et /SigFlags de l'AcroForm sont
   * des objets directs : s'ils sont des références, il remplacerait /Fields
   * par un tableau vide (perte des champs de formulaire existants). On les
   * rend donc directs avant d'ajouter le champ de signature.
   */
  function normaliserAcroForm(pdfDoc) {
    const { PDFName, PDFDict, PDFRef } = window.PDFLib;
    const acroForm = pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
    if (!acroForm) return;
    for (const cle of ["Fields", "SigFlags"]) {
      const valeur = acroForm.get(PDFName.of(cle));
      if (valeur instanceof PDFRef) acroForm.set(PDFName.of(cle), pdfDoc.context.lookup(valeur));
    }
  }

  /** Nombre de champs de signature déjà présents (signés ou non). */
  function compterSignaturesExistantes(pdfDoc) {
    const { PDFName, PDFDict, PDFSignature } = window.PDFLib;
    try {
      // getForm() créerait un AcroForm vide : on vérifie d'abord qu'il existe.
      if (!pdfDoc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)) return 0;
      return pdfDoc.getForm().getFields().filter((f) => f instanceof PDFSignature).length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Ajoute une signature PAdES au document pdf-lib (déjà modifié si besoin,
   * par exemple avec l'image de la signature manuscrite) et renvoie les
   * octets du PDF signé. Toute modification ultérieure du fichier rendra la
   * signature invalide, c'est le but.
   *
   * opts : { page (PDFPage), rect [x1,y1,x2,y2] ou absent (signature
   *          invisible), raison, lieu, contact, date }
   */
  async function signerPdf(pdfDoc, identite, opts) {
    const libs = await chargerBibliotheques();
    const o = opts || {};
    const date = o.date || new Date();

    normaliserAcroForm(pdfDoc);
    libs.pdflibAddPlaceholder({
      pdfDoc,
      pdfPage: o.page || pdfDoc.getPages()[0],
      reason: o.raison || "",
      contactInfo: o.contact || "",
      name: identite.titulaire,
      location: o.lieu || "",
      signingTime: date,
      signatureLength: TAILLE_SIGNATURE,
      subFilter: libs.SUBFILTER_ETSI_CADES_DETACHED,
      widgetRect: o.rect || [0, 0, 0, 0],
      appName: "tchadiaPdf",
    });

    // Pas de flux d'objets : la recherche du /ByteRange par @signpdf exige
    // un dictionnaire de signature lisible en clair dans le fichier.
    const avecPlaceholder = await pdfDoc.save({ useObjectStreams: false });

    class SignataireNavigateur extends libs.Signer {
      async sign(octetsCouverts) {
        const cms = await construireCms(libs, identite, octetsCouverts);
        return libs.Buffer.from(cms);
      }
    }

    const signe = await new libs.SignPdf().sign(libs.Buffer.from(avecPlaceholder), new SignataireNavigateur(), date);
    return new Uint8Array(signe.buffer, signe.byteOffset, signe.byteLength);
  }

  function messageErreur(e) {
    if (e instanceof ErreurPades) return e.message;
    return "La signature numérique a échoué. Vérifiez le certificat et réessayez.";
  }

  window.TchadiaPades = {
    chargerBibliotheques,
    lireCertificatP12,
    signerPdf,
    compterSignaturesExistantes,
    messageErreur,
    ErreurPades,
  };
})();
