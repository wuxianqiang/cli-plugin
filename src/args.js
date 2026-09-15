function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const args = { command, json: false };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--json') { args.json = true; continue; }
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else args[key] = true;
  }
  return args;
}
module.exports = { parseArgs };
