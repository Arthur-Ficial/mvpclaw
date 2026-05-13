/**
 * CLI entrypoint side-effect import: load `<cwd>/.env` into `process.env`
 * before any other module reads it. Project values override shell values
 * (see `src/lib/env-loader.ts` for the convention and tests).
 */
import { resolve } from 'node:path';
import { loadEnvFile } from '../lib/env-loader.js';

loadEnvFile(resolve(process.cwd(), '.env'));
