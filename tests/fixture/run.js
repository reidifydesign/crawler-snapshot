// Start the fixture site by hand: node tests/fixture/run.js [port]
import { startFixture } from './server.js';

const s = await startFixture({ port: Number(process.argv[2] || 4173) });
console.log(`fixture site on ${s.url}`);
