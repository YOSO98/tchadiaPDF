# Certificats de test (signature numérique PAdES)

Ces fichiers servent UNIQUEMENT aux tests automatisés de `signer-pdf`
(`tests/signer-pdf-pades.spec.js`). Ce ne sont pas des secrets : les clés
privées n'ont aucune valeur, ne sont reconnues par aucune autorité réelle
et leur mot de passe est public : `test1234`.

| Fichier | Contenu |
|---|---|
| `rsa-chaine.p12` | Clé RSA 2048 + certificat « Signataire de test » émis par « Autorite de test tchadiaPdf » + certificat de cette autorité (chaîne complète). Chiffrement PBES2 AES-256 (défaut OpenSSL 3). |
| `ca.crt` | Certificat de l'autorité de test, à utiliser comme ancre de confiance pour valider une signature produite avec `rsa-chaine.p12`. |
| `ec.p12` | Clé ECDSA P-256 + certificat auto-signé « Signataire EC de test ». |
| `ec-autosigne.crt` | Le certificat public de `ec.p12`. |
| `legacy.p12` | Même clé RSA, chiffrée avec l'ancien algorithme RC2-40/3DES (`openssl pkcs12 -legacy`) : sert à vérifier le message d'erreur, les navigateurs ne savent pas déchiffrer ce format. |

Validité : 10 ans à partir d'octobre 2026.

## Régénérer (OpenSSL 3)

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=Autorite de test tchadiaPdf/O=tchadiaPdf tests" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -nodes -keyout leaf.key -out leaf.csr \
  -subj "/CN=Signataire de test/O=tchadiaPdf tests/C=TD"
printf "keyUsage=critical,digitalSignature,nonRepudiation\nbasicConstraints=CA:FALSE\n" > ext.cnf
openssl x509 -req -in leaf.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out leaf.crt -days 3650 -extfile ext.cnf
openssl pkcs12 -export -inkey leaf.key -in leaf.crt -certfile ca.crt -name "Signataire de test" -passout pass:test1234 -out rsa-chaine.p12
openssl pkcs12 -export -legacy -inkey leaf.key -in leaf.crt -passout pass:test1234 -out legacy.p12
openssl ecparam -name prime256v1 -genkey -noout -out ec.key
openssl req -x509 -key ec.key -out ec-autosigne.crt -days 3650 -subj "/CN=Signataire EC de test"
openssl pkcs12 -export -inkey ec.key -in ec-autosigne.crt -passout pass:test1234 -out ec.p12
```

Les fichiers `.key` intermédiaires ne sont volontairement pas versionnés.

## Validation indépendante (hors tests automatisés)

Un PDF signé avec `rsa-chaine.p12` a été validé avec pyHanko
(`pyhanko sign validate --trust ca.crt fichier.pdf` : « The signature is
judged VALID », « The signature covers the entire file ») et avec
`openssl cms -verify` sur le contenu couvert par le `/ByteRange`.
