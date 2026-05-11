/**
 * Create a user in DATA_DIR/users.json (bcrypt password hash).
 *
 * Usage (from repo root):
 *   DATA_DIR=/path/to/data npm run create-user --workspace=@automaker/server -- alice 'secret-password'
 *
 * Or from apps/server:
 *   DATA_DIR=./data npm run create-user -- alice 'secret-password'
 */

import { createUser } from '../src/lib/users.js';

const [, , username, passwordArg] = process.argv;

if (!username || passwordArg === undefined) {
  console.error('Usage: npm run create-user -- <username> <password>');
  console.error('Set DATA_DIR if not using default ./data');
  process.exit(1);
}

createUser(username, passwordArg)
  .then((user) => {
    console.log(`Created user: ${user.username} (id: ${user.id})`);
  })
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
