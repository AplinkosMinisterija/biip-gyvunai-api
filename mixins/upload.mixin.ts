import mime from 'mime-types';
import { Context, default as Moleculer, RestSchema, default as moleculer } from 'moleculer';
import { UserAuthMeta } from '../services/api.service';
import { MultipartMeta } from '../types';

export default {
  actions: {
    uploadFile: {
      rest: <RestSchema>{
        method: 'POST',
        path: '/upload',
        type: 'multipart',
        busboyConfig: {
          limits: {
            files: 5,
          },
        },
      },
      async handler(
        ctx: Context<NodeJS.ReadableStream, UserAuthMeta & MultipartMeta & { protected?: boolean }>,
      ) {
        return this.upload(ctx);
      },
    },
    file: {
      rest: <RestSchema>{
        method: 'GET',
        path: '/file',
        params: {
          filename: 'string',
        },
      },
      async handler(ctx: Context<any, UserAuthMeta & MultipartMeta>) {
        return this.getPresignedUrl(ctx);
      },
    },
  },
  methods: {
    async upload(
      ctx: Context<NodeJS.ReadableStream, UserAuthMeta & MultipartMeta & { protected?: boolean }>,
    ) {
      if (
        !['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'].includes(
          ctx.meta.mimetype,
        )
      ) {
        throw new moleculer.Errors.MoleculerClientError(
          'Unsupported MIME type.',
          400,
          'UNSUPPORTED_MIMETYPE',
        );
      }

      const extension = mime.extension(ctx.meta.mimetype);
      const fileName = `${ctx.meta.filename.split('.')[0]}_${new Date().getTime()}.${extension}`;
      const objectName = `${this.name}/${fileName}`;

      try {
        await ctx.call('minio.putObject', ctx.params, {
          meta: {
            bucketName: process.env.MINIO_BUCKET,
            objectName: objectName,
            metaData: {
              'Content-Type': ctx.meta.mimetype,
            },
          },
        });
      } catch (_e) {
        throw new Moleculer.Errors.MoleculerClientError(
          'Unable to upload file.',
          400,
          'UNABLE_TO_UPLOAD',
        );
      }

      const { size }: { size: number } = await ctx.call('minio.statObject', {
        bucketName: process.env.MINIO_BUCKET,
        objectName,
      });

      const url = await ctx.call('minio.publicUrl', {
        bucketName: process.env.MINIO_BUCKET,
        objectName,
      });

      const presignedUrl = await ctx.call('minio.presignedGetObject', {
        bucketName: process.env.MINIO_BUCKET,
        objectName,
        expires: 60000,
        reqParams: {},
        requestDate: new Date().toDateString(),
      });

      return {
        url,
        presignedUrl,
        size,
        name: fileName,
      };
    },
    async getPresignedUrl(ctx: Context<{ filename: string }, UserAuthMeta>) {
      const objectName = `${this.name}/${ctx.params.filename}`;
      return await ctx.call('minio.presignedGetObject', {
        bucketName: process.env.MINIO_BUCKET,
        objectName,
        expires: 60000,
        reqParams: {},
        requestDate: new Date().toDateString(),
      });
    },
  },
};
