import path from 'node:path';
import type { AppConfig, Secrets } from '../config/schema.js';
import type { Logger } from '../logger.js';
import { LocalHttpPublisher } from './local-http.js';
import { NonePublisher, type ImagePublisher } from './publisher.js';
import { S3Publisher } from './s3.js';

export function createPublisher(config: AppConfig, secrets: Secrets, deps: { rootDir: string; logger: Logger }): ImagePublisher {
  switch (config.images.publisher) {
    case 'none':
      return new NonePublisher();
    case 'local_http':
      return new LocalHttpPublisher({
        publicDir: path.resolve(deps.rootDir, config.paths.data_dir, 'public'),
        port: config.images.local_http.port,
        bind: config.images.local_http.bind,
        publicBaseUrl: secrets.publicBaseUrl ?? '',
        logger: deps.logger,
      });
    case 's3': {
      const s = secrets.s3 ?? {};
      return new S3Publisher({
        endpoint: s.endpoint,
        region: s.region ?? 'auto',
        bucket: s.bucket ?? '',
        accessKeyId: s.accessKeyId ?? '',
        secretAccessKey: s.secretAccessKey ?? '',
        publicBaseUrl: s.publicBaseUrl ?? '',
        keyPrefix: config.images.s3.key_prefix,
        acl: config.images.s3.acl,
        forcePathStyle: config.images.s3.force_path_style,
      });
    }
  }
}
