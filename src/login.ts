import { beginLogin, finishLogin } from "./auth.ts";

const arg = process.argv[2];
if (!arg) {
  const url = await beginLogin();
  console.error("Open this URL, sign in with the Tesla account that owns the car, then paste the full redirected URL:");
  console.error(url);
  process.exit(0);
}

await finishLogin(arg);
console.error("Signed in. Token cache written (mode 0600).");
