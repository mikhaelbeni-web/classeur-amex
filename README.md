# Classeur Amex

Importe le relevé Amex (fichier Excel), associe chaque ligne à son
justificatif, et suit ce qui manque — un seul outil partagé entre toi et
ta comptable, à la place du Drive + Excel envoyé par email.

Stack : Next.js (frontend, déployé sur Vercel) + Firebase (Auth, Firestore
pour les lignes/statuts) + Supabase Storage (fichiers de justificatifs —
gratuit sans carte bancaire, contrairement à Firebase Storage).

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

## 1. Créer le projet Firebase (Auth + Firestore)

1. Va sur [console.firebase.google.com](https://console.firebase.google.com),
   crée un nouveau projet — le plan gratuit "Spark" suffit, pas besoin de
   passer en Blaze (on n'utilise pas Firebase Storage).
2. **Authentication** → onglet "Sign-in method" → active **Email/Password**.
3. **Authentication** → onglet "Users" → **Add user** : crée un compte pour
   toi et un pour ta comptable (email + mot de passe). C'est la seule façon
   de créer des comptes — il n'y a pas de page d'inscription dans l'app,
   volontairement.
4. **Firestore Database** → **Create database** → mode production → choisis
   une région proche (`eur3` / Europe si tu es en France).
5. **Paramètres du projet** (roue crantée) → **Général** → section "Vos
   applications" → **Ajouter une application** → Web (icône `</>`) → donne
   un nom, pas besoin de Firebase Hosting. Copie les valeurs de
   `firebaseConfig` qui s'affichent : tu en auras besoin à l'étape 3.

## 2. Créer le projet Supabase (Storage des justificatifs)

1. Va sur [supabase.com](https://supabase.com) → crée un compte (gratuit,
   aucune carte demandée) → **New project**.
2. Une fois le projet créé, va dans **Storage** (menu de gauche) →
   **New bucket** → nom exact : `justificatifs` → laisse **Public bucket**
   décoché (privé).
3. Va dans **SQL Editor** (menu de gauche) → **New query**, colle ceci, puis
   **Run** :

   ```sql
   create policy "justificatifs select"
   on storage.objects for select
   using ( bucket_id = 'justificatifs' );

   create policy "justificatifs insert"
   on storage.objects for insert
   with check ( bucket_id = 'justificatifs' );

   create policy "justificatifs delete"
   on storage.objects for delete
   using ( bucket_id = 'justificatifs' );
   ```

4. Va dans **Project Settings** (roue crantée) → **API** → copie l'URL du
   projet (**Project URL**) et la clé **anon public** : tu en auras besoin
   à l'étape 4.

## 3. Configurer les règles de sécurité Firestore

Ouvre `firestore.rules` à la racine du projet, et remplace les deux
adresses email d'exemple par la tienne et celle de ta comptable (celles
utilisées à l'étape 1.3) :

```
'toi@example.com',
'comptable@example.com'
```

Puis déploie les règles avec la [CLI Firebase](https://firebase.google.com/docs/cli) :

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # sélectionne le projet créé à l'étape 1
firebase deploy --only firestore:rules
```

(Tu peux aussi coller le contenu de `firestore.rules` directement dans
l'onglet "Règles" de Firestore sur la console web, si tu préfères éviter
la CLI.)

## 4. Configurer et lancer le projet en local

```bash
npm install
cp .env.local.example .env.local
```

Remplis `.env.local` : les 5 variables `NEXT_PUBLIC_FIREBASE_*` avec les
valeurs de l'étape 1.5, et les 2 variables `NEXT_PUBLIC_SUPABASE_*` avec
les valeurs de l'étape 2.4. Puis :

```bash
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000), connecte-toi avec un
des deux comptes créés à l'étape 1.3, et importe un relevé pour tester.

## 5. Déployer sur Vercel

1. Pousse ce dossier sur un repo GitHub (`git init`, `git add .`,
   `git commit`, crée le repo sur GitHub, `git push`).
2. Sur [vercel.com](https://vercel.com), **Add New → Project**, importe ce
   repo GitHub.
3. Dans les paramètres du projet Vercel, section **Environment Variables**,
   ajoute les 7 mêmes variables que dans `.env.local`.
4. Déploie. Le lien fourni par Vercel est celui à partager avec ta
   comptable (elle se connecte avec le compte créé à l'étape 1.3).

## Notes et limites à connaître

- **Coût** : Firebase Spark (Auth + Firestore) et Supabase Storage sont
  tous les deux gratuits à ce volume, sans carte bancaire nulle part.
  Aucune limite de taille comme celle qu'avait la toute première version
  (artifact Claude, plafonnée à 16 Mo au total) — le plan gratuit Supabase
  monte à 1 Go de stockage, largement suffisant pour des reçus/PDF.
- **Photos de reçus** : les images de plus de ~900 Ko sont automatiquement
  redimensionnées et recompressées côté navigateur avant l'envoi (max 2000px,
  JPEG qualité 85%), pour éviter que des photos de téléphone à 8-10 Mo ne
  saturent le stockage. Les PDF ne sont pas touchés.
- **Sécurité du stockage — un compromis à connaître** : la connexion
  (qui a le droit d'ouvrir l'app) est vérifiée par Firebase Auth, en dur,
  pour les deux comptes autorisés. En revanche, les policies Supabase
  Storage ci-dessus (étape 2.3) sont ouvertes à quiconque possède la clé
  publique du projet (la clé "anon", qui se retrouve forcément dans le
  code envoyé au navigateur) — la vraie protection vient du fait que (a)
  il faut d'abord passer l'écran de connexion Firebase pour voir l'app et
  obtenir un chemin de fichier, et (b) les noms de fichiers contiennent un
  identifiant aléatoire non devinable. C'est suffisant pour un outil à
  deux personnes dont l'URL n'est pas publiée nulle part, mais ce n'est
  pas un contrôle d'accès vérifié à chaque requête comme l'étaient les
  règles Firebase Storage dans la version précédente. Pour un contrôle
  plus strict plus tard (si l'outil grandit), il faudrait passer les
  uploads/téléchargements par une route API Next.js qui vérifie le jeton
  Firebase de l'utilisateur avant de parler à Supabase avec sa clé privée
  ("service role") — dis-le-moi si tu veux qu'on fasse cette évolution.
- **Ajouter un troisième compte** (par exemple si tu changes de comptable) :
  crée le compte dans Firebase Authentication, puis ajoute son email dans
  `firestore.rules`, et redéploie les règles
  (`firebase deploy --only firestore:rules`).
- **Reprendre les données de l'ancienne version (artifact Claude)** : si tu
  avais déjà importé des relevés et attaché des justificatifs dans le
  prototype précédent, ces données ne sont pas migrées automatiquement —
  il faudra réimporter le fichier Excel ici et rattacher les justificatifs
  déjà en ta possession.
