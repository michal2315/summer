import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  fileName: string;
  size: number;
  mimeType: string;
}

/**
 * Attachment bytes on local disk: UPLOAD_DIR/<summaryId>/<encoded file name>. Metadata lives in summary_files;
 * callers write bytes inside the DB transaction and remove them again if it rolls back.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = resolve(config.files.uploadDir);
  }

  /** Busboy decodes multipart file names as latin1; browsers send UTF-8 (Hebrew names would arrive garbled). */
  static displayName(original: string): string {
    const utf8 = Buffer.from(original, 'latin1').toString('utf8');
    const name = basename((utf8.includes('�') ? original : utf8).replace(/\\/g, '/'))
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
    if (!name || name === '.' || name === '..' || name.length > 255) throw new BadRequestException('invalid file name');
    return name;
  }

  async store(summaryId: string, files: UploadedFile[]): Promise<StoredFile[]> {
    if (!files.length) return [];
    const dir = this.dir(summaryId);
    await mkdir(dir, { recursive: true });
    const stored: StoredFile[] = [];
    for (const f of files) {
      const fileName = FilesService.displayName(f.originalname);
      await writeFile(this.path(summaryId, fileName), f.buffer);
      stored.push({ fileName, size: f.size, mimeType: f.mimetype || 'application/octet-stream' });
    }
    return stored;
  }

  open(summaryId: string, fileName: string): ReadStream {
    return createReadStream(this.path(summaryId, fileName));
  }

  async remove(summaryId: string, fileNames: string[]): Promise<void> {
    for (const name of fileNames) {
      await unlink(this.path(summaryId, name)).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') this.logger.warn(`could not delete ${summaryId}/${name}: ${e.message}`);
      });
    }
  }

  async removeAll(summaryId: string): Promise<void> {
    await rm(this.dir(summaryId), { recursive: true, force: true });
  }

  private dir(summaryId: string): string {
    return join(this.root, summaryId);
  }

  /**
   * Names are percent-encoded on disk so any Unicode name is a single safe path segment on every OS; the prefix
   * keeps Windows device names (CON, NUL…) from being interpreted.
   */
  private path(summaryId: string, fileName: string): string {
    return join(this.dir(summaryId), `f_${encodeURIComponent(fileName)}`);
  }
}
