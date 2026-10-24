import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Me } from '../auth/auth.guard';
import { CurrentUser } from '../auth/identity-provider';
import { IdPipe } from '../common/validation';
import { ApiFolder, ApiFolderItem, FoldersService } from './folders.service';

// Route order matters: `create` / `edit/:id` are declared before `:id/...`.
@Controller('folder')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  tree(@Me() me: CurrentUser): Promise<ApiFolder[]> {
    return this.folders.tree(me);
  }

  @Post('create')
  create(@Me() me: CurrentUser, @Body() body: unknown): Promise<ApiFolder> {
    return this.folders.create(me, body);
  }

  @Post('edit/:id')
  edit(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<ApiFolder | object> {
    return this.folders.edit(me, id, body);
  }

  @Get(':id/items')
  items(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<ApiFolderItem[]> {
    return this.folders.items(me, id);
  }

  @Post(':id/items/remove')
  async removeItems(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<object> {
    await this.folders.removeItems(me, id, body);
    return {};
  }

  @Post(':id/items')
  async addItems(@Me() me: CurrentUser, @Param('id', IdPipe) id: string, @Body() body: unknown): Promise<object> {
    await this.folders.addItems(me, id, body);
    return {};
  }

  @Delete(':id')
  async remove(@Me() me: CurrentUser, @Param('id', IdPipe) id: string): Promise<object> {
    await this.folders.delete(me, id);
    return {};
  }
}
