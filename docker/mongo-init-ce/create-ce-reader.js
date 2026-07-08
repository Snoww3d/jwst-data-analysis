// Community Edition read-only Mongo user (CE plan Phase 4).
//
// Runs from /docker-entrypoint-initdb.d on the FIRST initialization of an
// empty /data/db volume, authenticated as the root user. For a pre-seeded
// volume (the normal CE deploy path — the seed bundle ships a populated
// volume), run this manually once:
//
//   docker exec jwst-ce-mongodb mongosh -u "$MONGO_ROOT_USERNAME" \
//     -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
//     /docker-entrypoint-initdb.d/create-ce-reader.js
//
// The engine connects as ceReader (read role on the app database only), so
// even a full application compromise cannot write, drop, or admin the DB.

const dbName = process.env.MONGO_DATABASE || 'jwst_data_analysis';
const password = process.env.MONGO_CE_READER_PASSWORD;

if (!password) {
  throw new Error('MONGO_CE_READER_PASSWORD is not set — refusing to create ceReader');
}

const appDb = db.getSiblingDB(dbName);

const existing = appDb.getUser('ceReader');
if (existing) {
  print(`ceReader already exists in ${dbName} — updating password/roles`);
  appDb.updateUser('ceReader', { pwd: password, roles: [{ role: 'read', db: dbName }] });
} else {
  appDb.createUser({
    user: 'ceReader',
    pwd: password,
    roles: [{ role: 'read', db: dbName }],
  });
  print(`created ceReader with read-only access to ${dbName}`);
}
