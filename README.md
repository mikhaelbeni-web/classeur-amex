# Classeur Amex

Importe le relevé Amex (fichier Excel), associe chaque ligne à son
justificatif, et suit ce qui manque — un seul outil partagé entre toi et
ta comptable, à la place du Drive + Excel envoyé par email.

Stack : Next.js (frontend, déployé sur Vercel) + Firebase (Auth, Firestore
pour les lignes/statuts, Storage pour les fichiers de justificatifs).

## Ce que fait l'outil

- Tu uploades le fichier Excel du relevé (colonnes Date, Jal., Pièce / Lig.,
  Libellé, Référence, Débit, Crédit — le format que ta comptable produit).
  L'outil détecte automatiquement chaque mois dedans et les ajoute comme des
  relevés séparés.
- Si tu réimportes plus tard un fichier qui contient des mois déjà connus,
  seules les lignes nouvelles sont ajoutées (déduplication automatique par
  numéro de pièce comptable).
- Chaque ligne peut recevoir un justificatif (PDF ou photo), un statut
  (En attente / Reçu / Manquant) et une note libre.
- Connexion restreinte à deux comptes (toi + ta comptable) : pas
  d'inscription publique.

## 1. Créer le projet Firebase

1. Va sur [console.firebase.google.com](https://console.firebase.google.com),
   crée un nouveau projet (le plan gratuit "Spark" suffit largement à ce
   volume ; passe en "Blaze" — toujours quasi gratuit ici — seulement si
   Firebase te le demande pour activer Storage).
2. **Authentication** → onglet "Sign-in method" → active **Email/Password**.
3. **Authentication** → onglet "Users" → **Add user** : crée un compte pour
   toi et un pour ta comptable (email + mot de passe). C'est la seule façon
   de créer des comptes — il n'y a pas de page d'inscription dans l'app,
   volontairement.
4. **Firestore Database** → **Create database** → mode production → choisis
   une région proche (`eur3` / Europe si tu es en France).
5. **Storage** → **Get started** → mode production, même région.
6. **Paramètres du projet** (roue crantée) → **Général** → section "Vos
   applications" → **Ajouter une application** → Web (icône `</>`) → donne
   un nom, pas besoin de Firebase Hosting. Copie les valeurs de
   `firebaseConfig` qui s'affichent : tu en auras besoin à l'étape 3.

## 2. Configurer les règles de sécurité

Ouvre `firestore.rules` et `storage.rules` à la racine du projet, et
remplace les deux adresses email d'exemple par la tienne et celle de ta
comptable (celles utilisées à l'étape 1.3) :

```
'toi@example.com',
'comptable@example.com'
```

Puis déploie les règles avec la [CLI Firebase](https://firebase.google.com/docs/cli) :

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # sélectionne le projet créé à l'étape 1
firebase deploy --only firestore:rules,storage:rules
```

(Tu peux aussi coller le contenu de ces fichiers directement dans l'onglet
"Règles" de Firestore et de Storage sur la console web, si tu préfères
éviter la CLI.)

## 3. Configurer et lancer le projet en local

```bash
npm install
cp .env.local.example .env.local
```

Remplis `.env.local` avec les valeurs de `firebaseConfig` récupérées à
l'étape 1.6, puis :

```bash
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000), connecte-toi avec un
des deux comptes créés à l'étape 1.3, et importe un relevé pour tester.

## 4. Déployer sur Vercel

1. Pousse ce dossier sur un repo GitHub (`git init`, `git add .`,
   `git commit`, crée le repo sur GitHub, `git push`).
2. Sur [vercel.com](https://vercel.com), **Add New → Project**, importe ce
   repo GitHub.
3. Dans les paramètres du projet Vercel, section **Environment Variables**,
   ajoute les six mêmes variables que dans `.env.local`.
4. Déploie. Le lien fourni par Vercel est celui à partager avec ta
   comptable (elle se connecte avec le compte créé à l'étape 1.3).

## Notes et limites à connaître

- **Coût** : à ce volume (2 utilisateurs, quelques dizaines de lignes et de
  justificatifs par mois), tout tient très largement dans le plan gratuit
  Firebase (Spark) ou dans quelques centimes/mois en Blaze. Aucune limite de
  taille comme celle qu'avait la version précédente (artifact Claude,
  plafonnée à 16 Mo au total).
- **Photos de reçus** : les images de plus de ~900 Ko sont automatiquement
  redimensionnées et recompressées côté navigateur avant l'envoi (max 2000px,
  JPEG qualité 85%), pour éviter que des photos de téléphone à 8-10 Mo ne
  saturent le stockage. Les PDF ne sont pas touchés.
- **Accès aux justificatifs** : les fichiers sont récupérés via le SDK
  Firebase authentifié (pas par une URL publique), donc chaque lecture
  repasse par `storage.rules` — seuls les deux comptes autorisés peuvent
  effectivement ouvrir un justificatif, même si quelqu'un mettait la main
  sur un lien.
- **Ajouter un troisième compte** (par exemple si tu changes de comptable) :
  crée le compte dans Firebase Authentication, puis ajoute son email dans
  `firestore.rules` et `storage.rules`, et redéploie les règles
  (`firebase deploy --only firestore:rules,storage:rules`).
- **Reprendre les données de l'ancienne version (artifact Claude)** : si tu
  avais déjà importé des relevés et attaché des justificatifs dans le
  prototype précédent, ces données ne sont pas migrées automatiquement —
  il faudra réimporter le fichier Excel ici et rattacher les justificatifs
  déjà en ta possession.
