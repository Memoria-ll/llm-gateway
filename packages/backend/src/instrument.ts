// Sentry is opt-in on every deployment: no client is initialized unless the
// process environment provides SENTRY_DSN.
import * as Sentry from '@sentry/nestjs';
import { buildSentryInitOptions } from './sentry/sentry-options';
import { isEmbeddedMode } from './common/utils/manifest-mode';

const options = isEmbeddedMode() ? undefined : buildSentryInitOptions(process.env);
if (options) {
  Sentry.init(options);
}
