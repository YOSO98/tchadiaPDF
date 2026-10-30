/* tchadiaPdf : Word en PDF, isolation du parsing mammoth dans un Web Worker dedie.
   Objectif securite (Bloc 3 "Robustesse du traitement navigateur") : le parsing d'un fichier
   .docx est fondamentalement le parsing d'une archive ZIP + de XML fournis par l'utilisateur
   (potentiellement malveillants ou simplement corrompus/pathologiques). En le faisant tourner
   dans un worker dedie plutot que dans le thread principal :
   - un plantage, une boucle infinie ou une consommation memoire excessive du parseur ne gele
     pas l'interface (le thread principal reste reactif, la page peut annuler/afficher un message) ;
   - le code appelant (js/word-en-pdf.js) impose un delai maximal et termine le worker au-dela,
     ce qui n'est pas possible pour du code s'executant directement dans le thread principal.
   Ce worker est cree a la demande (un par fichier) et termine juste apres sa reponse, pour
   rester coherent avec le fait qu'aucun etat ne doit persister entre deux fichiers. */

importScripts("/vendor/mammoth-1.7.2.browser.min.js");

self.onmessage = async (e) => {
  const { arrayBuffer } = e.data || {};
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
    const warnings = (result.messages || []).filter((m) => m.type === "warning" || m.type === "error");
    self.postMessage({ ok: true, html: result.value, warnings: warnings });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
};
