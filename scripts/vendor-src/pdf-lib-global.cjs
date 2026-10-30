// pdf-lib est deja charge par la page (balise <script> CDN, global PDFLib) :
// le paquet vendorise reutilise cette instance plutot que d'en embarquer
// une seconde copie, pour que les objets PDF soient compatibles entre eux.
module.exports = globalThis.PDFLib;
