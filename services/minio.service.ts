'use strict';

import Moleculer, { Context } from 'moleculer';
import { Action, Service } from 'moleculer-decorators';
// @ts-ignore
import MinioMixin from 'moleculer-minio';

@Service({
  name: 'minio',
  mixins: [MinioMixin],
  settings: {
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT),
    useSSL: process.env.MINIO_USESSL === 'true',
    accessKey: process.env.MINIO_ACCESSKEY,
    secretKey: process.env.MINIO_SECRETKEY,
  },
})
export default class MinioService extends Moleculer.Service {
  @Action({
    params: {
      bucketName: 'string',
      objectName: 'string',
    },
  })
  publicUrl(ctx: Context<{ bucketName: string; objectName: string }>) {
    return (
      this.client.protocol +
      '//' +
      this.client.host +
      ':' +
      this.client.port +
      '/' +
      ctx.params.bucketName +
      '/' +
      ctx.params.objectName
    );
  }

  async started() {
    const bucketExists: boolean = await this.actions.bucketExists({
      bucketName: process.env.MINIO_BUCKET,
    });

    if (!bucketExists) {
      await this.actions.makeBucket({
        bucketName: process.env.MINIO_BUCKET,
      });
    }
  }

  created() {
    if (!process.env.MINIO_ACCESSKEY || !process.env.MINIO_SECRETKEY) {
      this.broker.fatal('MINIO is not configured');
    }
  }
}
