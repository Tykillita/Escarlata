# Firebase Sync: Escarlata-ia

Firebase is optional: the desktop app starts and operates without it. Create a dedicated Firebase project named `Escarlata-ia`, enable Google sign-in and create Firestore in production mode. Do not enable Functions, Cloud Run or billing for this first version.

Deploy the rules with `firebase deploy --only firestore:rules`. They limit all documents to the authenticated user and reject credential, token, provider-configuration, local-path and model-path fields. Web Firebase configuration is public configuration, not a secret; provide it to the renderer only as `VITE_FIREBASE_*` build variables (see `.env.example`). Never put a service-account JSON, API key for an LLM, OAuth token or local model configuration in Firestore.

The intended document root is `users/{uid}`. Conversations/messages are append-only and include a device ID and operation ID. Mutable entities must carry a revision; competing revisions are recorded locally for explicit resolution instead of silently overwriting data.
