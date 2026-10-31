import { Controller, Get, Header, Inject, Module, NotFoundException, Req, StreamableFile } from '@nestjs/common';
import { Request } from 'express';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Public } from '../auth/auth.guard';
import { APP_CONFIG, AppConfig } from '../config/app-config';

/**
 * The browser extension package, as written by summer-extension/scripts/pack.mjs. Served with the CRX media type
 * so a browser whose ExtensionInstallSources policy allows this origin installs it on click instead of downloading
 * it. The crx and the update manifest are public: Chrome fetches them without the app's token.
 */
const CRX_MIME = 'application/x-chrome-extension';
const CRX_FILE = 'summer-extension.crx';
const INFO_FILE = 'summer-extension.json';

interface ExtensionInfo {
  id: string;
  version: string;
}

const xmlAttr = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Controller('extension')
export class ExtensionController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Lets the install page know a package is published (and which version). */
  @Get()
  info(): Promise<ExtensionInfo> {
    return this.readInfo();
  }

  @Public()
  @Get(CRX_FILE)
  @Header('cache-control', 'no-cache')
  async crx(): Promise<StreamableFile> {
    const path = join(this.config.extensionDir, CRX_FILE);
    const size = await stat(path).then(
      (s) => s.size,
      () => {
        throw new NotFoundException('extension package not published');
      },
    );
    return new StreamableFile(createReadStream(path), { type: CRX_MIME, length: size });
  }

  /** Chrome's update protocol (gupdate): the manifest's update_url points here, so installs follow new packs. */
  @Public()
  @Get('updates.xml')
  @Header('content-type', 'application/xml; charset=utf-8')
  @Header('cache-control', 'no-cache')
  async updates(@Req() req: Request): Promise<string> {
    const { id, version } = await this.readInfo();
    const codebase = `${req.protocol}://${req.get('host')}/api/extension/${CRX_FILE}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${xmlAttr(id)}">
    <updatecheck codebase="${xmlAttr(codebase)}" version="${xmlAttr(version)}" />
  </app>
</gupdate>
`;
  }

  private async readInfo(): Promise<ExtensionInfo> {
    try {
      const info = JSON.parse(await readFile(join(this.config.extensionDir, INFO_FILE), 'utf8')) as ExtensionInfo;
      return { id: info.id, version: info.version };
    } catch {
      throw new NotFoundException('extension package not published');
    }
  }
}

@Module({ controllers: [ExtensionController] })
export class ExtensionModule {}
